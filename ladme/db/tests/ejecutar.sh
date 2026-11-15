#!/usr/bin/env bash
# Prueba el esquema y las migraciones en un PostgreSQL local desechable.
# Uso: PGURL=postgresql://usuario@localhost:5432/postgres bash ladme/db/tests/ejecutar.sh
set -euo pipefail
cd "$(dirname "$0")/.."
: "${PGURL:?Defina PGURL con la conexión a un PostgreSQL local de pruebas}"
BD="ladme_pruebas"
psql "$PGURL" -q -c "drop database if exists $BD" -c "create database $BD"
URL="${PGURL%/*}/$BD"
P() { psql "$URL" -q -v ON_ERROR_STOP=1 "$@"; }
P -f tests/00_stub_supabase.sql
P -f schema_ladme.sql
for m in migrations/*.sql; do P -f "$m"; done
P -f seed_equipos.sql >/dev/null
P -f tests/pruebas.sql
echo "TODAS LAS PRUEBAS PASARON"
