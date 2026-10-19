from rest_framework.decorators import api_view
from rest_framework.response import Response


@api_view(["GET"])
def health(request):
    """Liveness probe for the SignSeen API."""
    return Response({"status": "ok", "service": "signseen-api"})
