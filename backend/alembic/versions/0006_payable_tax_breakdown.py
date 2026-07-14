"""Add payable GST, TCS, and line item breakdown."""

from alembic import op
import sqlalchemy as sa


revision = "0006_payable_tax_breakdown"
down_revision = "0005_payable_actual_tds"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("llp_payables", sa.Column("cgst_amount", sa.Numeric(18, 2), nullable=False, server_default="0"))
    op.add_column("llp_payables", sa.Column("sgst_amount", sa.Numeric(18, 2), nullable=False, server_default="0"))
    op.add_column("llp_payables", sa.Column("igst_amount", sa.Numeric(18, 2), nullable=False, server_default="0"))
    op.add_column("llp_payables", sa.Column("tcs_amount", sa.Numeric(18, 2), nullable=False, server_default="0"))
    op.add_column("llp_payables", sa.Column("line_items", sa.Text(), nullable=False, server_default=""))
    op.execute("UPDATE llp_payables SET igst_amount = gst_amount WHERE gst_amount > 0")
    for column in ("cgst_amount", "sgst_amount", "igst_amount", "tcs_amount", "line_items"):
        op.alter_column("llp_payables", column, server_default=None)


def downgrade():
    op.drop_column("llp_payables", "line_items")
    op.drop_column("llp_payables", "tcs_amount")
    op.drop_column("llp_payables", "igst_amount")
    op.drop_column("llp_payables", "sgst_amount")
    op.drop_column("llp_payables", "cgst_amount")
