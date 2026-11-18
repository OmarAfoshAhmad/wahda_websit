# Independent chemical medicine eligibility

Approved in conversation: each beneficiary has an independent on/off state controlled by administration, with one-click saving and an audit entry. Default is off. Company policy and financial ceilings remain mandatory. Existing transactions and prescriptions remain in history when switched off; further dispensing is blocked, including from an already open prescription.

## Approaches
Direct control beside each beneficiary was selected over editing a full beneficiary form: fewer clicks and clear individual state. Store a boolean on Beneficiary rather than altering company policies or family state. Use existing admin and edit_beneficiary permission checks and company scope.

Implementation choice: keep the portal's current exclusion of chemical order requests; direct pharmacy dispensing becomes available for eligible beneficiaries.
