"""
app.discord — Discord OAuth2 + bot integration package.

Sub-modules:
  * :mod:`.client`   — thin httpx wrapper for the Discord REST API.
  * :mod:`.config`   — small helpers around server_settings to surface
                       the per-environment Discord credentials with a
                       single "is Discord configured?" predicate.

The actual route layer (``api/routes/auth_discord.py`` +
``api/routes/discord.py``) is added in later phases; this package is
the dependency surface they import.
"""
