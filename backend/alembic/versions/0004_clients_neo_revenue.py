"""add clients and neo revenue

Revision ID: 0004_clients_neo_revenue
Revises: 0003_user_signature_url
Create Date: 2026-06-14
"""

from alembic import op
import sqlalchemy as sa

revision = "0004_clients_neo_revenue"
down_revision = "0003_user_signature_url"
branch_labels = None
depends_on = None


def timestamps():
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    ]


def upgrade():
    op.create_table(
        "clients",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("client_name", sa.String(255), nullable=False),
        sa.Column("pan", sa.String(20), nullable=False),
        sa.Column("rm_name", sa.String(160), nullable=False),
        sa.Column("segment", sa.String(80), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.Column("partner_name", sa.String(160), nullable=False),
        sa.Column("llp_name", sa.String(255), nullable=False),
        sa.Column("family_name", sa.String(255), nullable=False),
        sa.Column("super_family_name", sa.String(255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_clients_pan", "clients", ["pan"])
    op.create_index("ix_clients_rm_name", "clients", ["rm_name"])
    op.create_index("ix_clients_status", "clients", ["status"])
    op.create_index("ix_clients_partner_name", "clients", ["partner_name"])
    op.create_index("ix_clients_llp_name", "clients", ["llp_name"])
    op.create_index("ix_clients_family_name", "clients", ["family_name"])
    op.create_index("ix_clients_super_family_name", "clients", ["super_family_name"])

    op.create_table(
        "neo_revenue",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("pan", sa.String(20), nullable=False),
        sa.Column("client_name", sa.String(255), nullable=False),
        sa.Column("rm_name", sa.String(160), nullable=False),
        sa.Column("transaction_date", sa.Date(), nullable=True),
        sa.Column("product", sa.String(160), nullable=False),
        sa.Column("transaction_type", sa.String(120), nullable=False),
        sa.Column("scheme_name", sa.String(255), nullable=False),
        sa.Column("investment_amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("commission_percent", sa.Numeric(18, 2), nullable=False),
        sa.Column("revenue_month", sa.String(40), nullable=False),
        sa.Column("revenue_amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("ytd_value", sa.Numeric(18, 2), nullable=False),
        sa.Column("statement_ref", sa.String(160), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.Column("partner_name", sa.String(160), nullable=False),
        sa.Column("llp_name", sa.String(255), nullable=False),
        sa.Column("family_name", sa.String(255), nullable=False),
        sa.Column("super_family_name", sa.String(255), nullable=False),
        sa.Column("income_type", sa.String(80), nullable=False),
        sa.Column("invoice_no", sa.String(80), nullable=False),
        sa.Column("invoice_month", sa.String(40), nullable=False),
        sa.Column("invoice_status", sa.String(40), nullable=False),
        sa.Column("receipt_status", sa.String(40), nullable=False),
        *timestamps(),
    )
    op.create_index("ix_neo_revenue_pan", "neo_revenue", ["pan"])
    op.create_index("ix_neo_revenue_client_name", "neo_revenue", ["client_name"])
    op.create_index("ix_neo_revenue_rm_name", "neo_revenue", ["rm_name"])
    op.create_index("ix_neo_revenue_transaction_date", "neo_revenue", ["transaction_date"])
    op.create_index("ix_neo_revenue_scheme_name", "neo_revenue", ["scheme_name"])
    op.create_index("ix_neo_revenue_revenue_month", "neo_revenue", ["revenue_month"])
    op.create_index("ix_neo_revenue_partner_name", "neo_revenue", ["partner_name"])
    op.create_index("ix_neo_revenue_llp_name", "neo_revenue", ["llp_name"])
    op.create_index("ix_neo_revenue_family_name", "neo_revenue", ["family_name"])
    op.create_index("ix_neo_revenue_super_family_name", "neo_revenue", ["super_family_name"])
    op.create_index("ix_neo_revenue_income_type", "neo_revenue", ["income_type"])
    op.create_index("ix_neo_revenue_invoice_no", "neo_revenue", ["invoice_no"])
    op.create_index("ix_neo_revenue_client_month", "neo_revenue", ["client_name", "revenue_month"])
    op.create_index("ix_neo_revenue_partner_month", "neo_revenue", ["partner_name", "revenue_month"])


def downgrade():
    op.drop_table("neo_revenue")
    op.drop_table("clients")
