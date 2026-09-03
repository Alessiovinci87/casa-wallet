#!/usr/bin/env bash
# Stage the Postgres flavour of schema.prisma (provider postgresql + real enums)
# without touching the local sqlite override. Usage: bash scripts/commit-schema-pg.sh
set -e
cd "$(dirname "$0")/.."
SRC=server/prisma/schema.prisma
cp "$SRC" "$SRC.local"
sed -i \
  -e '/^  \/\/ NOTE: sqlite for local dev/d' \
  -e '/^  \/\/ The String fields below work on both providers/d' \
  -e 's|provider = "sqlite"|provider = "postgresql"|' \
  -e 's|^  type        String      // TxType: INCOME \| EXPENSE$|  type        TxType|' \
  -e 's|^  method      String      // PayMethod: CASH \| POS \| CARD \| TRANSFER$|  method      PayMethod|' \
  "$SRC"
cat >> "$SRC" <<'EOT'

enum TxType {
  INCOME
  EXPENSE
}

enum PayMethod {
  CASH
  POS
  CARD
  TRANSFER
}
EOT
git add "$SRC"
mv "$SRC.local" "$SRC"
echo "staged postgres schema; local sqlite override restored"
