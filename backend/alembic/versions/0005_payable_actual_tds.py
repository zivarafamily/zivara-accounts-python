"""Track actual TDS deducted on payables."""

from alembic import op
import sqlalchemy as sa


revision = "0005_payable_actual_tds"
down_revision = "0004_clients_neo_revenue"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "llp_payables",
        sa.Column("tds_deducted_amount", sa.Numeric(18, 2), nullable=False, server_default="0"),
    )
    op.execute("UPDATE llp_payables SET tds_deducted_amount = tds_amount WHERE paid_amount > 0")
    op.alter_column("llp_payables", "tds_deducted_amount", server_default=None)


def downgrade():
    op.drop_column("llp_payables", "tds_deducted_amount")
