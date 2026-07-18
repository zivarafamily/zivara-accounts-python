"""Track who paid payable vendor bills."""

from alembic import op
import sqlalchemy as sa


revision = "0007_payable_reimbursement_tracking"
down_revision = "0006_payable_tax_breakdown"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("llp_payables", sa.Column("paid_by_type", sa.String(length=40), nullable=False, server_default="Company"))
    op.add_column("llp_payables", sa.Column("paid_by_name", sa.String(length=160), nullable=False, server_default=""))
    op.add_column("llp_payables", sa.Column("reimburse_to", sa.String(length=160), nullable=False, server_default=""))
    op.add_column("llp_payables", sa.Column("reimbursement_status", sa.String(length=40), nullable=False, server_default="Not Required"))
    op.add_column("llp_payables", sa.Column("reimbursement_date", sa.Date(), nullable=True))
    op.add_column("llp_payables", sa.Column("reimbursement_ref", sa.String(length=160), nullable=False, server_default=""))
    for column in ("paid_by_type", "paid_by_name", "reimburse_to", "reimbursement_status", "reimbursement_ref"):
        op.alter_column("llp_payables", column, server_default=None)


def downgrade():
    op.drop_column("llp_payables", "reimbursement_ref")
    op.drop_column("llp_payables", "reimbursement_date")
    op.drop_column("llp_payables", "reimbursement_status")
    op.drop_column("llp_payables", "reimburse_to")
    op.drop_column("llp_payables", "paid_by_name")
    op.drop_column("llp_payables", "paid_by_type")
