"""Render a web page URL to PDF on stdout.

Child process for render_url_to_pdf: running the render in a separate
process is what makes the overall timeout enforceable (a timed-out
thread could not be stopped). Invoked by convert.render_url_to_pdf,
not by hand.
"""

import sys

from django.core.management.base import BaseCommand, CommandError

from apps.signing.convert import ConversionError, _render_url_to_pdf_sync


class Command(BaseCommand):
    help = "Render a URL to PDF and write the bytes to stdout."

    def add_arguments(self, parser):
        parser.add_argument("url")

    def handle(self, *args, url, **options):
        try:
            pdf = _render_url_to_pdf_sync(url)
        except ConversionError as exc:
            raise CommandError(str(exc))
        sys.stdout.buffer.write(pdf)
