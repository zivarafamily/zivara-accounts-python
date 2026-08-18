"""Add ledger master and double-entry journal tables.

SQLite-safe migration.
"""

from alembic import op
import sqlalchemy as sa


revision = "0008_ledger_master"
down_revision = "0007_payable_reimbursement_tracking"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "ledgers",
        sa.Column("id", sa.String(length=40), primary_key=True),
        sa.Column("llp_id", sa.String(length=40), sa.ForeignKey("llps.id"), nullable=False),
        sa.Column("ledger_code", sa.String(length=40), nullable=False),
        sa.Column("ledger_name", sa.String(length=255), nullable=False),
        sa.Column("group_name", sa.String(length=120), nullable=False),
        sa.Column("account_type", sa.String(length=40), nullable=False),
        sa.Column("opening_balance", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("opening_side", sa.String(length=2), nullable=False, server_default="Dr"),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="Active"),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("system_key", sa.String(length=160), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("llp_id", "ledger_code", name="uq_ledgers_llp_code"),
        sa.UniqueConstraint("llp_id", "ledger_name", name="uq_ledgers_llp_name"),
    )
    op.create_index("ix_ledgers_llp_id", "ledgers", ["llp_id"])
    op.create_index("ix_ledgers_llp_group", "ledgers", ["llp_id", "group_name"])

    op.create_table(
        "journal_entries",
        sa.Column("id", sa.String(length=40), primary_key=True),
        sa.Column("llp_id", sa.String(length=40), sa.ForeignKey("llps.id"), nullable=False),
        sa.Column("entry_date", sa.Date(), nullable=True),
        sa.Column("voucher_type", sa.String(length=40), nullable=False, server_default="Journal"),
        sa.Column("voucher_no", sa.String(length=80), nullable=False, server_default=""),
        sa.Column("narration", sa.Text(), nullable=False, server_default=""),
        sa.Column("source_type", sa.String(length=80), nullable=False, server_default="manual"),
        sa.Column("source_id", sa.String(length=80), nullable=False, server_default=""),
        sa.Column("created_by", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_journal_entries_llp_id", "journal_entries", ["llp_id"])
    op.create_index("ix_journal_entries_entry_date", "journal_entries", ["entry_date"])
    op.create_index("ix_journal_source", "journal_entries", ["llp_id", "source_type", "source_id"])

    op.create_table(
        "journal_lines",
        sa.Column("id", sa.String(length=40), primary_key=True),
        sa.Column("journal_entry_id", sa.String(length=40), sa.ForeignKey("journal_entries.id", ondelete="CASCADE"), nullable=False),
        sa.Column("ledger_id", sa.String(length=40), sa.ForeignKey("ledgers.id"), nullable=False),
        sa.Column("debit", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("credit", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("particulars", sa.Text(), nullable=False, server_default=""),
    )
    op.create_index("ix_journal_lines_journal_entry_id", "journal_lines", ["journal_entry_id"])
    op.create_index("ix_journal_lines_ledger_id", "journal_lines", ["ledger_id"])
    op.create_index("ix_journal_lines_ledger_entry", "journal_lines", ["ledger_id", "journal_entry_id"])


def downgrade():
    op.drop_table("journal_lines")
    op.drop_table("journal_entries")
    op.drop_table("ledgers")
