# Milestone 3+: students only see the result once grading is published.
    # Pass/Fail verdict itself depends on review_status (handled below) —
    # pending_review just shows "Awaiting Review" on the frontend, it
    # doesn't block the result from loading.
    if current_user.role == RoleEnum.student and not result.published:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Your result is still being graded and hasn't been published yet",
        )

    questions = {q.question_id: q for q in _questions_for_exam(db, exam)}
    max_marks = sum(q.marks for q in questions.values())
    answers = db.query(models.Answer).filter(models.Answer.session_id == session_id).all()
    answers_by_qid = {a.question_id: a for a in answers}
    review_items = []
    for qid, q in questions.items():
        ans = answers_by_qid.get(qid)
        submitted_answer = ans.submitted_answer if ans else None
        is_correct = None
        grading_status = None
        score_awarded = None
        examiner_feedback = None
        correct_answer_out = None
        if q.question_type in (QuestionTypeEnum.mcq, QuestionTypeEnum.multi_select):
            correct_answer_out = q.correct_answer
            if submitted_answer is not None and q.correct_answer:
                is_correct = _grade_answer(q, submitted_answer, 0) > 0
        elif q.question_type in SUBJECTIVE_TYPES and ans:
            grading_status = ans.grading_status
            score_awarded = ans.examiner_score if ans.examiner_score is not None else ans.ai_score
            examiner_feedback = ans.examiner_feedback
        review_items.append(
            schemas.AnswerReviewItem(
                question_id=q.question_id,
                question_text=q.question_text,
                question_type=q.question_type,
                marks=q.marks,
                submitted_answer=submitted_answer,
                image_path=ans.image_path if ans else None,
                correct_answer=correct_answer_out,
                is_correct=is_correct,
                grading_status=grading_status,
                score_awarded=score_awarded,
                examiner_feedback=examiner_feedback,
            )
        )

    # Reject always wins over the marks-based calculation.
    if exam_session.review_status == ReviewStatusEnum.rejected:
        passed = False
    elif exam.pass_marks is not None:
        passed = result.marks >= exam.pass_marks
    elif exam_session.review_status == ReviewStatusEnum.approved:
        passed = True
    else:
        passed = None

    if exam_session.review_status == ReviewStatusEnum.rejected:
        feedback = "Your attempt was reviewed and rejected by the examiner. Result: Failed."
    else:
        feedback = result.feedback
        if not feedback:
            feedback = f"You scored {result.marks} out of {max_marks}."
        if passed is True and "passed" not in feedback.lower():
            feedback += " You passed."
        elif passed is False and "fail" not in feedback.lower():
            feedback += " You did not pass."

    return schemas.ResultOut(
        session_id=session_id,
        exam_title=exam.title,
        status=exam_session.status,
        marks=result.marks,
        max_marks=max_marks,
        published=result.published,
        feedback=feedback,
        pass_marks=exam.pass_marks,
        passed=passed,
        answers=review_items,
        review_status=exam_session.review_status,
    )