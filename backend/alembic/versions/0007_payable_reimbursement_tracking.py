"""Track who paid payable vendor bills."""

from alembic import op
import sqlalchemy as sa


revision = "0007_payable_reimbursement_tracking"
down_revision = "0006_payable_tax_breakdown"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "llp_payables",
        sa.Column(
            "paid_by_type",
            sa.String(length=40),
            nullable=False,
            server_default="Company",
        ),
    )
    op.add_column(
        "llp_payables",
        sa.Column(
            "paid_by_name",
            sa.String(length=160),
            nullable=False,
            server_default="",
        ),
    )
    op.add_column(
        "llp_payables",
        sa.Column(
            "reimburse_to",
            sa.String(length=160),
            nullable=False,
            server_default="",
        ),
    )
    op.add_column(
        "llp_payables",
        sa.Column(
            "reimbursement_status",
            sa.String(length=40),
            nullable=False,
            server_default="Not Required",
        ),
    )
    op.add_column(
        "llp_payables",
        sa.Column("reimbursement_date", sa.Date(), nullable=True),
    )
    op.add_column(
        "llp_payables",
        sa.Column(
            "reimbursement_ref",
            sa.String(length=160),
            nullable=False,
            server_default="",
        ),
    )

    # Keep server defaults for SQLite compatibility.
    # SQLite does not support ALTER COLUMN ... DROP DEFAULT.


def downgrade():
    with op.batch_alter_table("llp_payables") as batch_op:
        batch_op.drop_column("reimbursement_ref")
        batch_op.drop_column("reimbursement_date")
        batch_op.drop_column("reimbursement_status")
        batch_op.drop_column("reimburse_to")
        batch_op.drop_column("paid_by_name")
        batch_op.drop_column("paid_by_type")
