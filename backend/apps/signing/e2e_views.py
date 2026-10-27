"""Test-stack-only affordances for the Playwright review gallery (#31).

Guarded by ENABLE_E2E_FIXTURES exactly like the seed_e2e command: the
flag is set only by docker-compose.test.yml, so outside the test stack
these views answer 404 and no sealed document is ever renderable
through them in staging or production.
"""

import pymupdf
from django.conf import settings
from django.http import Http404, HttpResponse
from django.shortcuts import get_object_or_404

from .models import Document


def sealed_page(request, doc_id, page):
    """Render one page of a SEALED document's PDF to PNG (2x).

    The gallery script fetches page 1 and the last page of each sealed
    document the suite produced, so a human can check signature
    placement, the certificate page, field stamps, branding, and the
    free-tier watermark without re-running the flow.
    """
    if not settings.ENABLE_E2E_FIXTURES:
        raise Http404
    doc = get_object_or_404(Document, pk=doc_id)
    if not doc.signed_file:
        raise Http404
    with pymupdf.open(doc.signed_file.path) as pdf:
        if page < 1 or page > pdf.page_count:
            raise Http404
        pixmap = pdf[page - 1].get_pixmap(matrix=pymupdf.Matrix(2, 2))
        return HttpResponse(pixmap.tobytes("png"), content_type="image/png")
