"""l05_service: business orchestration on top of repos, SPI and domain models.

Layering rule (ADR-006): imports l01..l04 plus l03_adapters.spi / registry ONLY;
never a concrete driver module (import-lint enforces this).
"""

