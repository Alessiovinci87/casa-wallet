#!/bin/sh
# Initialize the production (PostgreSQL) database on first deploy.
# Uses `db push` to create the schema directly from schema.prisma
# (provider = postgresql, with the TxType/PayMethod enums), then seeds the 2 users.
npx prisma db push
node prisma/seed.js
