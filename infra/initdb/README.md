# SQL init scripts
# ─────────────────
# Place *.sql files here to pre-seed the Postgres database on first start.
# Files are executed in alphabetical order by the postgres image entrypoint.
#
# Example:
#   01_schema.sql   – CREATE TABLE statements
#   02_seed.sql     – INSERT statements for initial data
#
# This directory is mounted read-only into the postgres container at:
#   /docker-entrypoint-initdb.d/
