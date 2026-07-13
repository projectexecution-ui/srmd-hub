export const BP_CONFIG = {
  PORTAL_ID: '60062895348',

  PROJECTS: {
    NGH: '395368000000741425',
    P2:  '395368000001110066',
    VV:  '395368000001107938',
    EK:  '395368000001720081',
    RH:  '395368000001722146',
  } as const,

  // Days of inactivity before a bill is flagged as stalled
  STALL_DAYS: 21,
  // Push-list inclusion thresholds
  PUSH_LIST_MAX:      10,
  PUSH_MIN_AGE_DAYS:  24,
  PUSH_MIN_CLAIMED:   100_000,   // ₹1,00,000

  // Stage classification — adjust labels to match your Zoho portal exactly
  INTERNAL_STAGES: [
    'Under: Site Head',
    'Under: CT Billing',
    'Under: CT Head',
    'Under: CT Disc Head',
  ] as const,
  TRUST_STAGE: 'Submitted to Trust A/c',
  DONE_STAGE:  'Payment Done',

  // WO field values that indicate no work order is attached
  NO_WO_VALUES: ['Pending', 'Without WO', '0', ''] as const,

  // Storage
  BUCKET:           'bills-pipeline',
  KEEP_FILES:       12,
  APP_SETTINGS_KEY: 'bills_pipeline_last',

  // Zoho API
  ZOHO_TOKEN_URL: 'https://accounts.zoho.in/oauth/v2/token',
  ZOHO_API_BASE:  'https://projectsapi.zoho.in/api/v3',
  PAGE_SIZE:      200,

  // PNG card dimensions (portrait, 1080px wide)
  CARD_WIDTH: 1080,
  SECTION: {
    TITLE:       150,
    ACTION_BAND:  80,
    KPI_TILES:   130,
    BARS:        200,
    PUSH_HEADER:  40,
    PUSH_ROW:     40,
    FOOTER:       90,
  },

  // Custom field labels — adjust after inspecting your Zoho portal's API response
  CUSTOM_FIELDS: {
    BILL_NO:        'Bill No',
    VENDOR:         'Vendor',
    BUILDING:       'Building',
    RA_NO:          'RA No',
    BILL_TYPE:      'Bill Type',
    CLAIMED_AMOUNT: 'Claimed Amount',
    CERTIFIED_AMT:  'Certified Amount',
    PAID_AMOUNT:    'Paid Amount',
    BILL_DATE:      'Bill Date',
    WO_NO:          'WO No',
  },
} as const
