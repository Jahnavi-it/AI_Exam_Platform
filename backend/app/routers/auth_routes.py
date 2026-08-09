import os
import secrets
from datetime import datetime, timedelta

import requests
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from .. import schemas, models
from ..database import get_db
from ..auth_utils import hash_password, verify_password, create_access_token, get_current_user

router = APIRouter(prefix="/api/auth", tags=["Authentication"])

RESEND_API_KEY = os.getenv("RESEND_API_KEY")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")


@router.post("/register", response_model=schemas.UserOut, status_code=status.HTTP_201_CREATED)
def register(payload: schemas.RegisterRequest, db: Session = Depends(get_db)):
    existing = db.query(models.User).filter(models.User.email == payload.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email is already registered")

    user = models.User(
        name=payload.name,
        email=payload.email,
        password=hash_password(payload.password),
        role=payload.role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.post("/login", response_model=schemas.TokenResponse)
def login(payload: schemas.LoginRequest, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.email == payload.email).first()
    if not user or not verify_password(payload.password, user.password):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    token = create_access_token({"sub": user.user_id, "role": user.role.value})
    return schemas.TokenResponse(access_token=token, user=user)


@router.post("/forgot-password", status_code=status.HTTP_200_OK)
def forgot_password(payload: schemas.ForgotPasswordRequest, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.email == payload.email).first()

    # Always return the same message, whether or not the email exists,
    # so people can't use this endpoint to check which emails are registered.
    generic_response = {"message": "If that email is registered, a reset link has been sent."}

    if not user:
        return generic_response

    reset_token = secrets.token_urlsafe(32)
    user.reset_token = reset_token
    user.reset_token_expiry = datetime.utcnow() + timedelta(minutes=30)
    db.commit()

    reset_link = f"{FRONTEND_URL}/reset-password?token={reset_token}"

    if RESEND_API_KEY:
        try:
            requests.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {RESEND_API_KEY}"},
                json={
                    "from": "onboarding@resend.dev",
                    "to": [user.email],
                    "subject": "Reset your password - ProctorEd",
                    "html": (
                        f"<p>Hi {user.name},</p>"
                        f"<p>Click the link below to reset your password. "
                        f"This link expires in 30 minutes.</p>"
                        f'<p><a href="{reset_link}">{reset_link}</a></p>'
                        f"<p>If you didn't request this, you can ignore this email.</p>"
                    ),
                },
                timeout=10,
            )
        except requests.RequestException:
            # Don't fail the request just because the email provider had an issue;
            # the token is still saved and reset-password will still work if the
            # user has the link.
            pass

    return generic_response


@router.post("/reset-password", status_code=status.HTTP_200_OK)
def reset_password(payload: schemas.ResetPasswordRequest, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.reset_token == payload.token).first()

    if not user or not user.reset_token_expiry or user.reset_token_expiry < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Invalid or expired reset link")

    user.password = hash_password(payload.new_password)
    user.reset_token = None
    user.reset_token_expiry = None
    db.commit()

    return {"message": "Password has been reset successfully"}



@router.post("/change-password", status_code=status.HTTP_200_OK)
def change_password(
    payload: schemas.ChangePasswordRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if not verify_password(payload.current_password, current_user.password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")

    current_user.password = hash_password(payload.new_password)
    db.commit()

    return {"message": "Password changed successfully"}
