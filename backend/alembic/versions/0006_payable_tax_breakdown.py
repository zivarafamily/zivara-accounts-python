"""Add payable GST, TCS, and line item breakdown."""

from alembic import op
import sqlalchemy as sa


revision = "0006_payable_tax_breakdown"
down_revision = "0005_payable_actual_tds"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "llp_payables",
        sa.Column("cgst_amount", sa.Numeric(18, 2), nullable=False, server_default="0"),
    )
    op.add_column(
        "llp_payables",
        sa.Column("sgst_amount", sa.Numeric(18, 2), nullable=False, server_default="0"),
    )
    op.add_column(
        "llp_payables",
        sa.Column("igst_amount", sa.Numeric(18, 2), nullable=False, server_default="0"),
    )
    op.add_column(
        "llp_payables",
        sa.Column("tcs_amount", sa.Numeric(18, 2), nullable=False, server_default="0"),
    )
    op.add_column(
        "llp_payables",
        sa.Column("line_items", sa.Text(), nullable=False, server_default=""),
    )

    op.execute(
        "UPDATE llp_payables "
        "SET igst_amount = gst_amount "
        "WHERE gst_amount > 0"
    )

    # Keep server defaults for SQLite compatibility.
    # SQLite does not support ALTER COLUMN ... DROP DEFAULT.


def downgrade():
    with op.batch_alter_table("llp_payables") as batch_op:
        batch_op.drop_column("line_items")
        batch_op.drop_column("tcs_amount")
        batch_op.drop_column("igst_amount")
        batch_op.drop_column("sgst_amount")
        batch_op.drop_column("cgst_amount")
