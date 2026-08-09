"""
Auto-translation helper using the free MyMemory API.
No API key required (rate-limited, ~1000 words/day anonymous).
If a translation call fails, we fail soft — return None for that
language and let the caller skip it instead of crashing question creation.
"""

import json
import time
from typing import Optional, List

import httpx

from .models import SUPPORTED_LANGUAGES

MYMEMORY_URL = "https://api.mymemory.translated.net/get"
SOURCE_LANG = "en"
REQUEST_TIMEOUT = 8.0
RETRY_COUNT = 2
RETRY_DELAY_SECONDS = 1.5


def _translate_text(text: str, target_lang: str) -> Optional[str]:
    if not text or not text.strip():
        return None

    params = {
        "q": text,
        "langpair": f"{SOURCE_LANG}|{target_lang}",
    }

    last_error = None
    for attempt in range(RETRY_COUNT + 1):
        try:
            with httpx.Client(timeout=REQUEST_TIMEOUT) as client:
                resp = client.get(MYMEMORY_URL, params=params)
                resp.raise_for_status()
                data = resp.json()
                translated = data.get("responseData", {}).get("translatedText")
                if translated:
                    return translated
                last_error = data.get("responseDetails", "empty response")
        except Exception as exc:
            last_error = exc
        time.sleep(RETRY_DELAY_SECONDS)

    print(f"[translate_utils] failed to translate to '{target_lang}': {last_error}")
    return None


def translate_question(
    question_text: str,
    options: Optional[List[str]],
    target_languages: Optional[List[str]] = None,
) -> dict:
    """
    Returns a dict: { "<lang_code>": {"question_text": str, "options": list|None} }
    Only includes languages that translated successfully.
    """
    langs = target_languages or [l for l in SUPPORTED_LANGUAGES if l != SOURCE_LANG]
    results = {}

    for lang in langs:
        translated_text = _translate_text(question_text, lang)
        if translated_text is None:
            continue

        translated_options = None
        if options:
            translated_options = []
            for opt in options:
                t_opt = _translate_text(opt, lang)
                translated_options.append(t_opt if t_opt else opt)

        results[lang] = {
            "question_text": translated_text,
            "options": translated_options,
        }

    return results
