"""agentgateway adapter: renderer, applier and usage reader for the official binary.

This package is the only place allowed to know agentgateway nouns (ADR-006).
The binary itself is NEVER touched from here beyond reading its SQLite log and
writing the config file into the whitelisted directory.
"""

