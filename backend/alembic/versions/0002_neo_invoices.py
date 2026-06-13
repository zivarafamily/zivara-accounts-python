"""add neo invoices

Revision ID: 0002_neo_invoices
Revises: 0001_initial
Create Date: 2026-06-13
"""

from alembic import op
import sqlalchemy as sa

revision = "0002_neo_invoices"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def timestamps():
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    ]


def upgrade():
    op.create_table(
        "neo_invoices",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("llp_id", sa.String(40), sa.ForeignKey("llps.id"), nullable=True),
        sa.Column("raised_by", sa.String(160), nullable=False),
        sa.Column("invoice_type", sa.String(120), nullable=False),
        sa.Column("gst_mode", sa.String(40), nullable=False),
        sa.Column("is_proforma", sa.Boolean(), nullable=False),
        sa.Column("invoice_title", sa.String(80), nullable=False),
        sa.Column("invoice_no", sa.String(80), nullable=False),
        sa.Column("invoice_date", sa.Date(), nullable=True),
        sa.Column("billing_month", sa.String(40), nullable=False),
        sa.Column("seller_name", sa.String(255), nullable=False),
        sa.Column("seller_address", sa.Text(), nullable=False),
        sa.Column("seller_gstin", sa.String(20), nullable=False),
        sa.Column("seller_pan", sa.String(20), nullable=False),
        sa.Column("seller_state", sa.String(80), nullable=False),
        sa.Column("buyer_name", sa.String(255), nullable=False),
        sa.Column("buyer_address", sa.Text(), nullable=False),
        sa.Column("buyer_gstin", sa.String(20), nullable=False),
        sa.Column("buyer_state", sa.String(80), nullable=False),
        sa.Column("particulars", sa.Text(), nullable=False),
        sa.Column("sac_code", sa.String(40), nullable=False),
        sa.Column("taxable_amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("gst_rate", sa.Numeric(18, 2), nullable=False),
        sa.Column("gst_type", sa.String(40), nullable=False),
        sa.Column("gst_amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("tax_amount_in_words", sa.Text(), nullable=False),
        sa.Column("amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("amount_in_words", sa.Text(), nullable=False),
        sa.Column("narration", sa.Text(), nullable=False),
        sa.Column("tds_rate", sa.Numeric(18, 2), nullable=False),
        sa.Column("tds_amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("net_payable", sa.Numeric(18, 2), nullable=False),
        sa.Column("bank_name", sa.String(160), nullable=False),
        sa.Column("account_no", sa.String(80), nullable=False),
        sa.Column("branch_ifsc", sa.String(255), nullable=False),
        sa.Column("authorised_signatory", sa.String(160), nullable=False),
        sa.Column("status", sa.String(40), nullable=False),
        sa.Column("pdf_link", sa.Text(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False),
        *timestamps(),
        sa.UniqueConstraint("llp_id", "invoice_no", name="uq_neo_invoices_llp_invoice_no"),
    )
    op.create_index("ix_neo_invoices_llp_id", "neo_invoices", ["llp_id"])
    op.create_index("ix_neo_invoices_invoice_no", "neo_invoices", ["invoice_no"])
    op.create_index("ix_neo_invoices_billing_month", "neo_invoices", ["billing_month"])
    op.create_index("ix_neo_invoices_status", "neo_invoices", ["status"])
    op.create_index("ix_neo_invoices_llp_month", "neo_invoices", ["llp_id", "billing_month"])


def downgrade():
    op.drop_table("neo_invoices")
