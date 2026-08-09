"""
MILESTONE 3 — LLM-based subjective answer evaluation module.

Weeks 3-4 requirement: "pass all short_answer and long_answer submissions
through an LLM-based evaluation module ... that generates a suggested
score, a brief justification, and key points matched/missed against the
model answer."

We use the Anthropic API (ANTHROPIC_API_KEY) since that's the LLM
provider already wired into this environment; the brief's "OpenAI GPT-4o
or equivalent" language is satisfied by any capable LLM — swap the
_call_llm() implementation for openai.ChatCompletion if the team prefers.

If no API key is configured, grade_subjective() falls back to a
deterministic keyword-overlap heuristic so the grading pipeline still
runs end-to-end in dev/demo environments without a key. This is called
out explicitly in the response so it's never silently mistaken for a
real LLM score.
"""
import json
import os
import re
from dataclasses import dataclass
from typing import List, Optional

import requests
from dotenv import load_dotenv

load_dotenv()

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
ANTHROPIC_MODEL = os.getenv("ANTHROPIC_GRADING_MODEL", "claude-sonnet-4-6")
ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"


@dataclass
class GradingResult:
    score_fraction: float               # 0.0 - 1.0 of the question's max marks
    justification: str
    key_points_matched: List[str]
    key_points_missed: List[str]
    used_llm: bool                      # False if the heuristic fallback ran


# ---------------------------------------------------------------------
# LLM call
# ---------------------------------------------------------------------
def _call_llm(question_text: str, model_answer: str, submitted_answer: str) -> Optional[dict]:
    if not ANTHROPIC_API_KEY:
        return None

    system_prompt = (
        "You are an exam grading assistant. Score the student's answer against "
        "the model answer, strictly for content coverage and correctness — not "
        "writing style. Respond with ONLY a JSON object, no prose, no markdown "
        "fences, in exactly this shape:\n"
        '{"score_fraction": <float 0.0-1.0>, "justification": <string, 1-2 sentences>, '
        '"key_points_matched": [<string>, ...], "key_points_missed": [<string>, ...]}'
    )
    user_prompt = (
        f"Question:\n{question_text}\n\n"
        f"Model answer / rubric:\n{model_answer or '(no model answer provided — grade for general correctness)'}\n\n"
        f"Student's submitted answer:\n{submitted_answer or '(blank — no answer submitted)'}"
    )

    try:
        resp = requests.post(
            ANTHROPIC_API_URL,
            headers={
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": ANTHROPIC_MODEL,
                "max_tokens": 500,
                "system": system_prompt,
                "messages": [{"role": "user", "content": user_prompt}],
            },
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        text = "".join(block.get("text", "") for block in data.get("content", []) if block.get("type") == "text")
        text = text.strip()
        text = re.sub(r"^```(json)?|```$", "", text.strip(), flags=re.MULTILINE).strip()
        parsed = json.loads(text)
        return parsed
    except Exception:
        # Network error, bad key, malformed JSON from the model, etc. — fall
        # back to the heuristic rather than blocking the grading pipeline.
        return None


# ---------------------------------------------------------------------
# Heuristic fallback (no API key configured)
# ---------------------------------------------------------------------
_STOPWORDS = {
    "the", "a", "an", "is", "are", "was", "were", "of", "to", "and", "or",
    "in", "on", "for", "with", "that", "this", "it", "as", "be", "by",
    "at", "from", "which", "has", "have", "not",
}


def _keywords(text: str) -> set:
    words = re.findall(r"[a-zA-Z0-9]+", (text or "").lower())
    return {w for w in words if w not in _STOPWORDS and len(w) > 2}


def _heuristic_grade(model_answer: str, submitted_answer: str) -> dict:
    model_kw = _keywords(model_answer)
    given_kw = _keywords(submitted_answer)

    if not (submitted_answer or "").strip():
        return {
            "score_fraction": 0.0,
            "justification": "No answer was submitted.",
            "key_points_matched": [],
            "key_points_missed": sorted(model_kw)[:8],
        }

    if not model_kw:
        # No rubric to compare against — give partial credit for effort,
        # examiner review decides the rest.
        return {
            "score_fraction": 0.5,
            "justification": "No model answer configured; heuristic gave partial credit pending examiner review.",
            "key_points_matched": [],
            "key_points_missed": [],
        }

    matched = model_kw & given_kw
    missed = model_kw - given_kw
    fraction = round(len(matched) / len(model_kw), 2) if model_kw else 0.0

    return {
        "score_fraction": fraction,
        "justification": (
            f"Heuristic keyword-overlap scoring (no LLM key configured): "
            f"{len(matched)}/{len(model_kw)} key terms from the model answer were present."
        ),
        "key_points_matched": sorted(matched)[:8],
        "key_points_missed": sorted(missed)[:8],
    }


# ---------------------------------------------------------------------
# Public entrypoint
# ---------------------------------------------------------------------
def grade_subjective(question_text: str, model_answer: Optional[str], submitted_answer: Optional[str]) -> GradingResult:
    llm_result = _call_llm(question_text, model_answer or "", submitted_answer or "")
    if llm_result is not None:
        try:
            return GradingResult(
                score_fraction=max(0.0, min(1.0, float(llm_result.get("score_fraction", 0.0)))),
                justification=str(llm_result.get("justification", "")).strip() or "AI grading complete.",
                key_points_matched=list(llm_result.get("key_points_matched", []))[:10],
                key_points_missed=list(llm_result.get("key_points_missed", []))[:10],
                used_llm=True,
            )
        except (TypeError, ValueError):
            pass  # malformed payload -> fall through to heuristic

    fallback = _heuristic_grade(model_answer or "", submitted_answer or "")
    return GradingResult(
        score_fraction=fallback["score_fraction"],
        justification=fallback["justification"],
        key_points_matched=fallback["key_points_matched"],
        key_points_missed=fallback["key_points_missed"],
        used_llm=False,
    )


# ---------------------------------------------------------------------
# OCR for handwritten image_upload answers (best-effort)
# ---------------------------------------------------------------------
def ocr_image(image_path: str) -> Optional[str]:
    """Extracts legible text from a handwritten-answer image via Tesseract.
    Returns None (rather than raising) if pytesseract / the tesseract
    binary isn't installed — image answers still route to examiner review
    without OCR, per the brief's "best-effort" framing."""
    try:
        import pytesseract
        from PIL import Image

        text = pytesseract.image_to_string(Image.open(image_path))
        text = text.strip()
        return text or None
    except Exception:
        return None
