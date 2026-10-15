# ADR-0034 §4: a budget alert. AWS Budgets is on the Free plan's service list (see README.md for the
# evidence). On the Free plan the credits pay every charge, so a budget on net cost would sit at $0;
# this one excludes credits and tracks the gross spend the credits are paying for.

resource "aws_budgets_budget" "monthly" {
  name         = "satis-${local.environment}-monthly"
  budget_type  = "COST"
  limit_amount = format("%.2f", var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_types {
    include_credit = false
    include_refund = false
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.budget_alert_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.budget_alert_email]
  }
}
