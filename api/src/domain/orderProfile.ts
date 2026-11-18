/**
 * The order facts collected in the chat (spec 7.3): which brands the customer is buying, and the
 * items. Stored in contact_profiles.profile (`brands`, `items`) and on leads.
 */

/** The two brands, as stored. Display names (brands.name): 'Imperial Indopack', 'Kertas Supreme'. */
export type BrandSlug = 'imperial_indopack' | 'kertas_supreme';
