"""Secure onboarding (part 4): invitation and password-reset links, TOTP enrollment.

Administration never sees or hands out a password: it sends links by email (``EmailSender``)
and the person sets her own password (and, when invited, her authenticator app) on public,
token-based routes. See ``docs/platform/api/slice-11-invitations.md``.
"""
