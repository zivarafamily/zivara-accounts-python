"""initial schema

Revision ID: 0001_initial
Revises:
Create Date: 2026-06-10
"""

from alembic import op
import sqlalchemy as sa

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def timestamps():
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    ]


def upgrade():
    op.create_table("llps",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("llp_name", sa.String(255), nullable=False),
        sa.Column("short_code", sa.String(40), nullable=False),
        sa.Column("gstin", sa.String(20), nullable=False),
        sa.Column("pan", sa.String(20), nullable=False),
        sa.Column("address", sa.Text(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_llps_short_code", "llps", ["short_code"], unique=True)
    op.create_index("ix_llps_status", "llps", ["status"])

    op.create_table("users",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("username", sa.String(120), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("role", sa.String(40), nullable=False),
        sa.Column("allowed_modules", sa.Text(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        *timestamps(),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)
    op.create_index("ix_users_username", "users", ["username"], unique=True)
    op.create_index("ix_users_role", "users", ["role"])
    op.create_index("ix_users_status", "users", ["status"])

    op.create_table("llp_partners",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("llp_id", sa.String(40), sa.ForeignKey("llps.id"), nullable=False),
        sa.Column("user_id", sa.String(40), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("role", sa.String(40), nullable=False),
        sa.Column("percentage", sa.String(40), nullable=False),
        sa.Column("allowed_modules", sa.Text(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("llp_id", "user_id", name="uq_llp_partners_llp_user"),
    )
    op.create_index("ix_llp_partners_llp_id", "llp_partners", ["llp_id"])
    op.create_index("ix_llp_partners_user_id", "llp_partners", ["user_id"])

    op.create_table("partners",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("partner_name", sa.String(160), nullable=False),
        sa.Column("llp_id", sa.String(40), sa.ForeignKey("llps.id"), nullable=True),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("mobile", sa.String(40), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_partners_llp_id", "partners", ["llp_id"])

    op.create_table("vendors",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("llp_id", sa.String(40), sa.ForeignKey("llps.id"), nullable=True),
        sa.Column("vendor_name", sa.String(255), nullable=False),
        sa.Column("category", sa.String(120), nullable=False),
        sa.Column("gstin", sa.String(20), nullable=False),
        sa.Column("pan", sa.String(20), nullable=False),
        sa.Column("state", sa.String(80), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("llp_id", "vendor_name", name="uq_vendors_llp_name"),
    )
    op.create_index("ix_vendors_llp_id", "vendors", ["llp_id"])

    op.create_table("llp_payables",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("llp_id", sa.String(40), sa.ForeignKey("llps.id"), nullable=False),
        sa.Column("vendor_id", sa.String(40), sa.ForeignKey("vendors.id"), nullable=True),
        sa.Column("vendor_name", sa.String(255), nullable=False),
        sa.Column("vendor_category", sa.String(120), nullable=False),
        sa.Column("vendor_gstin", sa.String(20), nullable=False),
        sa.Column("vendor_pan", sa.String(20), nullable=False),
        sa.Column("bill_no", sa.String(120), nullable=False),
        sa.Column("normalized_bill_no", sa.String(120), nullable=False),
        sa.Column("bill_date", sa.Date(), nullable=True),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("expense_type", sa.String(120), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("taxable_amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("gst_amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("gross_amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("tds_section", sa.String(40), nullable=False),
        sa.Column("tds_rate", sa.Numeric(18, 2), nullable=False),
        sa.Column("tds_amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("net_payable", sa.Numeric(18, 2), nullable=False),
        sa.Column("paid_amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("payment_date", sa.Date(), nullable=True),
        sa.Column("payment_mode", sa.String(80), nullable=False),
        sa.Column("bank_account", sa.String(160), nullable=False),
        sa.Column("reference_no", sa.String(160), nullable=False),
        sa.Column("challan_no", sa.String(120), nullable=False),
        sa.Column("challan_date", sa.Date(), nullable=True),
        sa.Column("interest_amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("status", sa.String(40), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False),
        *timestamps(),
        sa.UniqueConstraint("llp_id", "vendor_id", "normalized_bill_no", name="uq_payables_llp_vendor_bill"),
    )
    op.create_index("ix_llp_payables_llp_id", "llp_payables", ["llp_id"])
    op.create_index("ix_llp_payables_vendor_id", "llp_payables", ["vendor_id"])
    op.create_index("ix_llp_payables_status", "llp_payables", ["status"])
    op.create_index("ix_payables_llp_bill", "llp_payables", ["llp_id", "bill_no"])

    op.create_table("expenses",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("llp_id", sa.String(40), sa.ForeignKey("llps.id"), nullable=False),
        sa.Column("expense_date", sa.Date(), nullable=True),
        sa.Column("expense_type", sa.String(120), nullable=False),
        sa.Column("category", sa.String(120), nullable=False),
        sa.Column("paid_by", sa.String(160), nullable=False),
        sa.Column("charge_to", sa.String(160), nullable=False),
        sa.Column("reimburse_to", sa.String(160), nullable=False),
        sa.Column("payment_mode", sa.String(80), nullable=False),
        sa.Column("taxable_value", sa.Numeric(18, 2), nullable=False),
        sa.Column("cgst_amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("sgst_amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("igst_amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("gst_amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("vendor_or_person", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("bill_available", sa.Boolean(), nullable=False),
        sa.Column("bill_link", sa.Text(), nullable=False),
        sa.Column("employee_name", sa.String(160), nullable=False),
        sa.Column("billing_month", sa.String(40), nullable=False),
        sa.Column("travel_id", sa.String(80), nullable=False),
        sa.Column("partner_allocations", sa.Text(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.Column("status", sa.String(40), nullable=False),
        sa.Column("reimburse_mode", sa.String(80), nullable=False),
        sa.Column("reimburse_account", sa.String(160), nullable=False),
        sa.Column("reimburse_date", sa.Date(), nullable=True),
        sa.Column("reimburse_ref", sa.String(160), nullable=False),
        sa.Column("reimburse_by", sa.String(160), nullable=False),
        sa.Column("approved_by", sa.String(160), nullable=False),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_expenses_llp_id", "expenses", ["llp_id"])
    op.create_index("ix_expenses_expense_date", "expenses", ["expense_date"])
    op.create_index("ix_expenses_status", "expenses", ["status"])

    op.create_table("receipts",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("llp_id", sa.String(40), sa.ForeignKey("llps.id"), nullable=False),
        sa.Column("receipt_date", sa.Date(), nullable=True),
        sa.Column("reference_type", sa.String(120), nullable=False),
        sa.Column("reference_no", sa.String(160), nullable=False),
        sa.Column("month", sa.String(40), nullable=False),
        sa.Column("amount_received", sa.Numeric(18, 2), nullable=False),
        sa.Column("receipt_mode", sa.String(80), nullable=False),
        sa.Column("bank_account", sa.String(160), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_receipts_llp_id", "receipts", ["llp_id"])

    op.create_table("bank_accounts",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("llp_id", sa.String(40), sa.ForeignKey("llps.id"), nullable=False),
        sa.Column("account_name", sa.String(160), nullable=False),
        sa.Column("bank_name", sa.String(160), nullable=False),
        sa.Column("account_number", sa.String(80), nullable=False),
        sa.Column("ifsc", sa.String(20), nullable=False),
        sa.Column("account_type", sa.String(80), nullable=False),
        sa.Column("branch", sa.String(160), nullable=False),
        sa.Column("opening_balance", sa.Numeric(18, 2), nullable=False),
        sa.Column("current_balance", sa.Numeric(18, 2), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False),
        *timestamps(),
        sa.UniqueConstraint("llp_id", "account_number", name="uq_bank_accounts_llp_number"),
    )
    op.create_index("ix_bank_accounts_llp_id", "bank_accounts", ["llp_id"])

    op.create_table("cash_book_entries",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("llp_id", sa.String(40), sa.ForeignKey("llps.id"), nullable=False),
        sa.Column("entry_date", sa.Date(), nullable=True),
        sa.Column("entry_type", sa.String(40), nullable=False),
        sa.Column("opening_balance", sa.Numeric(18, 2), nullable=False),
        sa.Column("amount_in", sa.Numeric(18, 2), nullable=False),
        sa.Column("amount_out", sa.Numeric(18, 2), nullable=False),
        sa.Column("closing_balance", sa.Numeric(18, 2), nullable=False),
        sa.Column("reference_type", sa.String(120), nullable=False),
        sa.Column("reference_id", sa.String(80), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("paid_by", sa.String(160), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_cash_book_entries_llp_id", "cash_book_entries", ["llp_id"])
    op.create_index("ix_cash_book_entries_entry_date", "cash_book_entries", ["entry_date"])

    op.create_table("audit_logs",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("user_email", sa.String(255), nullable=False),
        sa.Column("module", sa.String(80), nullable=False),
        sa.Column("action", sa.String(80), nullable=False),
        sa.Column("ref_no", sa.String(120), nullable=False),
        sa.Column("old_value", sa.Text(), nullable=False),
        sa.Column("new_value", sa.Text(), nullable=False),
        sa.Column("remarks", sa.Text(), nullable=False),
    )
    op.create_index("ix_audit_logs_timestamp", "audit_logs", ["timestamp"])

    op.create_table("uploaded_bills",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("llp_id", sa.String(40), sa.ForeignKey("llps.id"), nullable=True),
        sa.Column("source_type", sa.String(80), nullable=False),
        sa.Column("source_id", sa.String(80), nullable=False),
        sa.Column("original_filename", sa.String(255), nullable=False),
        sa.Column("stored_filename", sa.String(255), nullable=False),
        sa.Column("content_type", sa.String(120), nullable=False),
        sa.Column("file_path", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_uploaded_bills_llp_id", "uploaded_bills", ["llp_id"])

    op.create_table("settings",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("llp_id", sa.String(40), sa.ForeignKey("llps.id"), nullable=True),
        sa.Column("key", sa.String(120), nullable=False),
        sa.Column("value", sa.Text(), nullable=False),
        *timestamps(),
        sa.UniqueConstraint("llp_id", "key", name="uq_settings_llp_key"),
    )
    op.create_index("ix_settings_llp_id", "settings", ["llp_id"])


def downgrade():
    for table in [
        "settings", "uploaded_bills", "audit_logs", "cash_book_entries", "bank_accounts",
        "receipts", "expenses", "llp_payables", "vendors", "partners", "llp_partners",
        "users", "llps",
    ]:
        op.drop_table(table)
