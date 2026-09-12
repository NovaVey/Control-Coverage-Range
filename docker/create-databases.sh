#!/usr/bin/env bash
# Runs once, on first init, via postgres:16's own /docker-entrypoint-initdb.d
# convention. POSTGRES_DB is left at the image's own default ('postgres') so
# this script owns creating both logical databases this range's docker-compose
# actually uses — Principal-Graph's own docker-compose.yml and RBA's own each
# assume they own the whole Postgres instance; this range shares one instance
# between both real projects instead of running two, so this replaces that
# part of either project's own compose file rather than reusing it verbatim.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
    CREATE DATABASE "${PRINCIPAL_GRAPH_DB:-principalgraph}";
    CREATE DATABASE "${RBA_DB:-authz_service}";
EOSQL
