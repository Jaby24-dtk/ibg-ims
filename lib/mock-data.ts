import type { Product, Supplier, Transaction, PurchaseOrder, Alert, User } from '@/types'

const _isReal = (() => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return url.length > 0 && !url.includes('your-project-ref')
})()

export const mockUsers: User[] = [
  { id: 'u1', name: 'Maria Santos', email: 'maria@company.com', role: 'administrator', created_at: '2024-01-01' },
  { id: 'u2', name: 'Carlos Reyes', email: 'carlos@company.com', role: 'inventory_manager', created_at: '2024-01-15' },
  { id: 'u3', name: 'Ana Cruz', email: 'ana@company.com', role: 'staff', created_at: '2024-02-01' },
  { id: 'u4', name: 'Jose Dela Rosa', email: 'jose@company.com', role: 'viewer', created_at: '2024-03-01' },
]

export const mockSuppliers: Supplier[] = [
  { id: 's1', name: 'MedSupply PH', contact_person: 'Roberto Tan', email: 'sales@medsupply.ph', phone: '02-8123-4567', address: 'Makati City, Metro Manila' },
  { id: 's2', name: 'DetectTech Corp', contact_person: 'Linda Go', email: 'orders@detecttech.com', phone: '02-8765-4321', address: 'BGC, Taguig City' },
  { id: 's3', name: 'PhilMed Distributors', contact_person: 'Mark Lim', email: 'mark@philmed.com', phone: '02-8555-0011', address: 'Mandaluyong City' },
  { id: 's4', name: 'Global Health Supplies', contact_person: 'Susan Park', email: 'susan@globalhealth.com', phone: '02-8333-9988', address: 'Pasig City' },
]

export const mockProducts: Product[] = [
  {
    id: 'p1', name: 'N95 Respirator Mask', sku: 'MED-N95-001', barcode: '8901234567890',
    brand: 'SafeGuard', category: 'Medical', description: 'NIOSH-approved N95 particulate respirator for healthcare professionals.',
    batch_number: 'BN2024-0091', expiry_date: '2026-08-15', unit_cost: 85, selling_price: 120,
    reorder_level: 500, stock_quantity: 1240, supplier_id: 's1', image_url: '',
    created_at: '2024-01-10', updated_at: '2025-05-20',
  },
  {
    id: 'p2', name: 'Rapid Antigen Test Kit', sku: 'DET-RAT-002', barcode: '8901234567891',
    brand: 'QuickTest Pro', category: 'Detection', description: '15-minute rapid antigen test for COVID-19 and respiratory pathogens.',
    batch_number: 'BN2024-0145', expiry_date: '2025-12-31', unit_cost: 220, selling_price: 350,
    reorder_level: 200, stock_quantity: 85, supplier_id: 's2', image_url: '',
    created_at: '2024-01-15', updated_at: '2025-06-10',
  },
  {
    id: 'p3', name: 'Digital Thermometer Pro', sku: 'MED-DTH-003', barcode: '8901234567892',
    brand: 'MedSense', category: 'Medical', description: 'Non-contact infrared thermometer with 0.1°C accuracy.',
    batch_number: 'BN2024-0201', expiry_date: '2027-03-22', unit_cost: 680, selling_price: 950,
    reorder_level: 50, stock_quantity: 12, supplier_id: 's3', image_url: '',
    created_at: '2024-02-01', updated_at: '2025-06-01',
  },
  {
    id: 'p4', name: 'Metal Detector Wand', sku: 'DET-MDW-004', barcode: '8901234567893',
    brand: 'SecureScan', category: 'Detection', description: 'Handheld security metal detector, 360° detection coverage.',
    batch_number: 'BN2024-0312', expiry_date: '2028-06-10', unit_cost: 1850, selling_price: 2800,
    reorder_level: 20, stock_quantity: 34, supplier_id: 's2', image_url: '',
    created_at: '2024-02-15', updated_at: '2025-05-30',
  },
  {
    id: 'p5', name: 'Surgical Gloves (Box/100)', sku: 'MED-SGL-005', barcode: '8901234567894',
    brand: 'CleanHands', category: 'Medical', description: 'Powder-free latex surgical gloves, sterile, size M.',
    batch_number: 'BN2024-0401', expiry_date: '2025-06-20', unit_cost: 380, selling_price: 580,
    reorder_level: 100, stock_quantity: 0, supplier_id: 's1', image_url: '',
    created_at: '2024-03-01', updated_at: '2025-06-14',
  },
  {
    id: 'p6', name: 'Drug Test Kit (Urine)', sku: 'DET-DTK-006', barcode: '8901234567895',
    brand: 'TrustScreen', category: 'Detection', description: 'Multi-panel urine drug test — screens 10 substances.',
    batch_number: 'BN2024-0511', expiry_date: '2025-07-08', unit_cost: 95, selling_price: 160,
    reorder_level: 150, stock_quantity: 48, supplier_id: 's4', image_url: '',
    created_at: '2024-03-15', updated_at: '2025-06-12',
  },
  {
    id: 'p7', name: 'Pulse Oximeter', sku: 'MED-POX-007', barcode: '8901234567896',
    brand: 'VitalCheck', category: 'Medical', description: 'Fingertip pulse oximeter with LED display, SpO2 & heart rate.',
    batch_number: 'BN2024-0602', expiry_date: '2027-11-30', unit_cost: 420, selling_price: 680,
    reorder_level: 30, stock_quantity: 76, supplier_id: 's3', image_url: '',
    created_at: '2024-04-01', updated_at: '2025-05-25',
  },
  {
    id: 'p8', name: 'Blood Pressure Monitor', sku: 'MED-BPM-008', barcode: '8901234567897',
    brand: 'CardioTrack', category: 'Medical', description: 'Automatic upper arm blood pressure monitor with memory function.',
    batch_number: 'BN2024-0711', expiry_date: '2028-01-15', unit_cost: 1200, selling_price: 1850,
    reorder_level: 25, stock_quantity: 18, supplier_id: 's3', image_url: '',
    created_at: '2024-04-15', updated_at: '2025-06-05',
  },
  {
    id: 'p9', name: 'Alcohol Hand Sanitizer (500ml)', sku: 'MED-AHS-009', barcode: '8901234567898',
    brand: 'PureGuard', category: 'Medical', description: '70% isopropyl alcohol hand sanitizer with aloe vera.',
    batch_number: 'BN2024-0801', expiry_date: '2026-09-30', unit_cost: 95, selling_price: 145,
    reorder_level: 200, stock_quantity: 560, supplier_id: 's1', image_url: '',
    created_at: '2024-05-01', updated_at: '2025-06-10',
  },
  {
    id: 'p10', name: 'Explosive Trace Detector', sku: 'DET-ETD-010', barcode: '8901234567899',
    brand: 'ThreatSense', category: 'Detection', description: 'Portable IMS-based explosive trace detector, airport-grade.',
    batch_number: 'BN2024-0901', expiry_date: '2029-12-31', unit_cost: 185000, selling_price: 250000,
    reorder_level: 2, stock_quantity: 5, supplier_id: 's2', image_url: '',
    created_at: '2024-05-15', updated_at: '2025-06-01',
  },
  {
    id: 'p11', name: 'Face Shield (Clear)', sku: 'MED-FSH-011', barcode: '8901234567800',
    brand: 'SafeGuard', category: 'Medical', description: 'Full-face reusable protective shield, adjustable headband.',
    batch_number: 'BN2024-1001', expiry_date: '2025-06-25', unit_cost: 65, selling_price: 110,
    reorder_level: 100, stock_quantity: 22, supplier_id: 's1', image_url: '',
    created_at: '2024-06-01', updated_at: '2025-06-13',
  },
  {
    id: 'p12', name: 'PCR Test Reagent Kit', sku: 'DET-PCR-012', barcode: '8901234567801',
    brand: 'GenomeTech', category: 'Detection', description: 'Real-time PCR reagent kit for molecular diagnostics, 96-well.',
    batch_number: 'BN2024-1101', expiry_date: '2025-08-20', unit_cost: 8500, selling_price: 12000,
    reorder_level: 10, stock_quantity: 8, supplier_id: 's4', image_url: '',
    created_at: '2024-06-15', updated_at: '2025-06-11',
  },
]

export const mockTransactions: Transaction[] = [
  { id: 't1', product_id: 'p1', sku: 'MED-N95-001', barcode: '8901234567890', type: 'inbound', quantity: 500, user_id: 'u2', notes: 'Monthly restock', created_at: '2025-06-14T09:30:00' },
  { id: 't2', product_id: 'p2', sku: 'DET-RAT-002', barcode: '8901234567891', type: 'outbound', quantity: 50, user_id: 'u3', notes: 'Branch delivery - Makati', created_at: '2025-06-14T10:15:00' },
  { id: 't3', product_id: 'p5', sku: 'MED-SGL-005', barcode: '8901234567894', type: 'outbound', quantity: 20, user_id: 'u3', notes: 'Emergency request', created_at: '2025-06-14T11:00:00' },
  { id: 't4', product_id: 'p7', sku: 'MED-POX-007', barcode: '8901234567896', type: 'barcode_scan', quantity: 5, user_id: 'u2', notes: 'Barcode scan — receive stock', created_at: '2025-06-13T14:00:00' },
  { id: 't5', product_id: 'p9', sku: 'MED-AHS-009', barcode: '8901234567898', type: 'inbound', quantity: 200, user_id: 'u2', notes: 'PO #PO-2025-041 received', created_at: '2025-06-13T09:00:00' },
  { id: 't6', product_id: 'p3', sku: 'MED-DTH-003', barcode: '8901234567892', type: 'adjustment', quantity: -3, user_id: 'u1', notes: 'Damaged units removed', created_at: '2025-06-12T16:30:00' },
  { id: 't7', product_id: 'p4', sku: 'DET-MDW-004', barcode: '8901234567893', type: 'outbound', quantity: 10, user_id: 'u3', notes: 'Client order #ORD-8821', created_at: '2025-06-12T11:20:00' },
  { id: 't8', product_id: 'p6', sku: 'DET-DTK-006', barcode: '8901234567895', type: 'inbound', quantity: 100, user_id: 'u2', notes: 'Emergency restock', created_at: '2025-06-11T08:45:00' },
]

export const mockPurchaseOrders: PurchaseOrder[] = [
  {
    id: 'po1', order_number: 'PO-2025-041', supplier_id: 's1', status: 'received',
    total_cost: 95000, notes: 'Monthly restock for medical supplies',
    created_at: '2025-06-01', updated_at: '2025-06-13',
  },
  {
    id: 'po2', order_number: 'PO-2025-042', supplier_id: 's2', status: 'approved',
    total_cost: 37000, notes: 'Detection equipment reorder',
    created_at: '2025-06-05', updated_at: '2025-06-10',
  },
  {
    id: 'po3', order_number: 'PO-2025-043', supplier_id: 's4', status: 'pending',
    total_cost: 68000, notes: 'PCR kits and drug test kits',
    created_at: '2025-06-10', updated_at: '2025-06-10',
  },
  {
    id: 'po4', order_number: 'PO-2025-044', supplier_id: 's3', status: 'draft',
    total_cost: 22500, notes: 'Draft — pending approval from admin',
    created_at: '2025-06-14', updated_at: '2025-06-14',
  },
  {
    id: 'po5', order_number: 'PO-2025-039', supplier_id: 's1', status: 'cancelled',
    total_cost: 12000, notes: 'Cancelled — supplier out of stock',
    created_at: '2025-05-28', updated_at: '2025-06-02',
  },
]

export const mockAlerts: Alert[] = [
  { id: 'a1', type: 'out_of_stock', message: 'Surgical Gloves (Box/100) is OUT OF STOCK. Reorder immediately.', status: 'unread', product_id: 'p5', created_at: '2025-06-14T08:00:00' },
  { id: 'a2', type: 'low_stock', message: 'Rapid Antigen Test Kit is below reorder level (85 / 200 units).', status: 'unread', product_id: 'p2', created_at: '2025-06-14T08:01:00' },
  { id: 'a3', type: 'expiring_product', message: 'Surgical Gloves (Box/100) expires on 2025-06-20 (Critical: 5 days).', status: 'unread', product_id: 'p5', created_at: '2025-06-14T08:02:00' },
  { id: 'a4', type: 'expiring_product', message: 'Face Shield (Clear) expires on 2025-06-25 (Critical: 10 days).', status: 'unread', product_id: 'p11', created_at: '2025-06-14T08:03:00' },
  { id: 'a5', type: 'low_stock', message: 'Drug Test Kit (Urine) is below reorder level (48 / 150 units).', status: 'read', product_id: 'p6', created_at: '2025-06-13T10:00:00' },
  { id: 'a6', type: 'new_purchase_order', message: 'New Purchase Order PO-2025-043 submitted for approval.', status: 'read', created_at: '2025-06-10T09:00:00' },
  { id: 'a7', type: 'expiring_product', message: 'Drug Test Kit (Urine) expires on 2025-07-08 (Warning: 23 days).', status: 'read', product_id: 'p6', created_at: '2025-06-13T08:00:00' },
  { id: 'a8', type: 'low_stock', message: 'PCR Test Reagent Kit is below reorder level (8 / 10 units).', status: 'unread', product_id: 'p12', created_at: '2025-06-14T08:05:00' },
  { id: 'a9', type: 'low_stock', message: 'Digital Thermometer Pro is below reorder level (12 / 50 units).', status: 'unread', product_id: 'p3', created_at: '2025-06-14T08:06:00' },
]

export const currentUser: User = mockUsers[0]

// When real Supabase is configured, clear all mock data so pages start empty
if (_isReal) {
  mockUsers.length = 0
  mockSuppliers.length = 0
  mockProducts.length = 0
  mockTransactions.length = 0
  mockPurchaseOrders.length = 0
  mockAlerts.length = 0
}
