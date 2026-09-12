"""Re-run the employee-name migration for sites that still contain HR-EMP keys.

The original patch may already be recorded as completed on long-lived sites.
This new patch id makes the company-code naming contract observable and ensures
Frappe Link fields, including User Permission, are renamed together.
"""

from hrms.patches.v16_0.use_company_employee_code_as_employee_name import execute


__all__ = ["execute"]
