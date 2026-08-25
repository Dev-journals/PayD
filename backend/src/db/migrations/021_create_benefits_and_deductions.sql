-- Migration 021: Benefit plans & deduction rules
-- Adds configurable non-salary payroll components (benefits, retirement, taxes, etc.)

CREATE TABLE IF NOT EXISTS benefit_plans (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  provider_name VARCHAR(255),
  provider_wallet_address VARCHAR(56),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_benefit_plans_org_id ON benefit_plans(organization_id);
CREATE INDEX IF NOT EXISTS idx_benefit_plans_active ON benefit_plans(organization_id, is_active);

CREATE TRIGGER update_benefit_plans_updated_at BEFORE UPDATE ON benefit_plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE benefit_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY benefit_plans_isolation_select ON benefit_plans
  FOR SELECT
  USING (organization_id = current_tenant_id());

CREATE POLICY benefit_plans_isolation_insert ON benefit_plans
  FOR INSERT
  WITH CHECK (organization_id = current_tenant_id());

CREATE POLICY benefit_plans_isolation_update ON benefit_plans
  FOR UPDATE
  USING (organization_id = current_tenant_id())
  WITH CHECK (organization_id = current_tenant_id());

CREATE POLICY benefit_plans_isolation_delete ON benefit_plans
  FOR DELETE
  USING (organization_id = current_tenant_id());

-- Employee enrollments for benefit plans
CREATE TABLE IF NOT EXISTS employee_benefit_enrollments (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  benefit_plan_id INTEGER NOT NULL REFERENCES benefit_plans(id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_employee_benefit UNIQUE (employee_id, benefit_plan_id)
);

CREATE INDEX IF NOT EXISTS idx_employee_benefit_enrollments_org_id ON employee_benefit_enrollments(organization_id);
CREATE INDEX IF NOT EXISTS idx_employee_benefit_enrollments_employee_id ON employee_benefit_enrollments(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_benefit_enrollments_plan_id ON employee_benefit_enrollments(benefit_plan_id);

CREATE TRIGGER update_employee_benefit_enrollments_updated_at BEFORE UPDATE ON employee_benefit_enrollments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE employee_benefit_enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY employee_benefit_enrollments_isolation_select ON employee_benefit_enrollments
  FOR SELECT
  USING (organization_id = current_tenant_id());

CREATE POLICY employee_benefit_enrollments_isolation_insert ON employee_benefit_enrollments
  FOR INSERT
  WITH CHECK (organization_id = current_tenant_id());

CREATE POLICY employee_benefit_enrollments_isolation_update ON employee_benefit_enrollments
  FOR UPDATE
  USING (organization_id = current_tenant_id())
  WITH CHECK (organization_id = current_tenant_id());

CREATE POLICY employee_benefit_enrollments_isolation_delete ON employee_benefit_enrollments
  FOR DELETE
  USING (organization_id = current_tenant_id());

-- Generic deduction rules (fixed or percentage). Can optionally link to a benefit plan.
CREATE TABLE IF NOT EXISTS deduction_rules (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('percentage', 'fixed')),
  value DECIMAL(20, 7) NOT NULL CHECK (value >= 0),
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  priority INTEGER DEFAULT 0,
  benefit_plan_id INTEGER REFERENCES benefit_plans(id) ON DELETE SET NULL,
  employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
  destination_wallet_address VARCHAR(56),
  destination_kind VARCHAR(20) NOT NULL DEFAULT 'treasury' CHECK (destination_kind IN ('treasury', 'provider')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_deduction_rules_org_id ON deduction_rules(organization_id);
CREATE INDEX IF NOT EXISTS idx_deduction_rules_active ON deduction_rules(organization_id, is_active);
CREATE INDEX IF NOT EXISTS idx_deduction_rules_employee_id ON deduction_rules(employee_id);
CREATE INDEX IF NOT EXISTS idx_deduction_rules_benefit_plan_id ON deduction_rules(benefit_plan_id);

CREATE TRIGGER update_deduction_rules_updated_at BEFORE UPDATE ON deduction_rules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE deduction_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY deduction_rules_isolation_select ON deduction_rules
  FOR SELECT
  USING (organization_id = current_tenant_id());

CREATE POLICY deduction_rules_isolation_insert ON deduction_rules
  FOR INSERT
  WITH CHECK (organization_id = current_tenant_id());

CREATE POLICY deduction_rules_isolation_update ON deduction_rules
  FOR UPDATE
  USING (organization_id = current_tenant_id())
  WITH CHECK (organization_id = current_tenant_id());

CREATE POLICY deduction_rules_isolation_delete ON deduction_rules
  FOR DELETE
  USING (organization_id = current_tenant_id());
