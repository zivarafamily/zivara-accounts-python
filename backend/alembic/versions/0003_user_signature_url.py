"""add user signature url

Revision ID: 0003_user_signature_url
Revises: 0002_neo_invoices
Create Date: 2026-06-14
"""

from alembic import op
import sqlalchemy as sa

revision = "0003_user_signature_url"
down_revision = "0002_neo_invoices"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("signature_url", sa.Text(), nullable=False, server_default=""))


def downgrade():
    op.drop_column("users", "signature_url")
