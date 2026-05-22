import type { PackageItemResponse } from '@submittal/shared/api';

export type DocType = PackageItemResponse['item']['doc_type'];

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  product_data: 'Product data',
  shop_drawing: 'Shop drawing',
  sds: 'SDS',
  warranty: 'Warranty',
  installation: 'Installation',
  test_report: 'Test report',
  other: 'Other',
};

export const DOC_TYPE_OPTIONS: { value: DocType; label: string }[] = (
  Object.keys(DOC_TYPE_LABELS) as DocType[]
).map((value) => ({ value, label: DOC_TYPE_LABELS[value] }));

export const ATTRIBUTE_LABELS: Record<
  PackageItemResponse['attributes'][number]['key'],
  string
> = {
  manufacturer: 'Manufacturer',
  model_number: 'Model #',
  description: 'Description',
  spec_section_ref: 'Spec section',
};
