"""Contact-center platform API (LATAM Bank, transaction-dispute intake)."""

from importlib.metadata import PackageNotFoundError, version

try:
    __version__ = version("cc-platform")
except PackageNotFoundError:  # pragma: no cover - running from a source tree without install
    __version__ = "0.0.0+local"

__all__ = ["__version__"]
