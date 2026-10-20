"""Authentication variants for endpoints that do not require an account.

DRF's TokenAuthentication raises AuthenticationFailed for an unknown
token *before* permission checks run, so a stale token in a browser
(deleted server-side by logout elsewhere, a password reset, or a
database reset) 401s even public / optionally-authenticated endpoints.

- Token-addressed signer endpoints sidestep this by using
  ``authentication_classes([])``: possession of the signing token is
  the credential, and any sender Authorization header is ignored.
- Optionally-authenticated sender endpoints use
  OptionalTokenAuthentication: a valid token authenticates as usual,
  an invalid one degrades to anonymous instead of failing the request.
"""

from rest_framework.authentication import TokenAuthentication, get_authorization_header
from rest_framework.exceptions import AuthenticationFailed


class OptionalTokenAuthentication(TokenAuthentication):
    """TokenAuthentication that treats a bad token as anonymous.

    Returns None only when credentials were presented but invalid;
    valid tokens and session auth behave exactly as the defaults.
    """

    def authenticate(self, request):
        if not get_authorization_header(request):
            return None
        try:
            return super().authenticate(request)
        except AuthenticationFailed:
            return None
