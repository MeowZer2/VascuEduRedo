// Illustrative starter import payload for the verified device catalog pipeline.
//
// IMPORTANT: these entries carry only publicly-known device IDENTITY
// (name / manufacturer / category / family / territory). They deliberately
// contain NO diameters, lengths, sheath sizes, or other numeric specs and NO
// `lastVerifiedAt`, so the importer flags them as UNVERIFIED / INCOMPLETE.
// Replace with manufacturer/IFU-sourced data before treating any spec as
// clinically reliable.

import type { DeviceCatalogImport } from '../lib/deviceCatalog';

export const SAMPLE_DEVICE_IMPORT: DeviceCatalogImport = {
  version: 'vascedu/devices@1',
  sourceName: 'VascEdu illustrative starter set (identity only — NOT verified specs)',
  sourceDate: '2026-05-17',
  devices: [
    {
      name: 'Excluder AAA Endoprosthesis',
      manufacturer: 'W. L. Gore & Associates',
      category: 'Aortic endograft',
      subtype: 'Bifurcated infrarenal',
      deviceFamily: 'Excluder',
      vascularTerritory: 'Infrarenal abdominal aorta',
      indicationsSummary: 'Infrarenal abdominal aortic aneurysm repair (EVAR).',
      tags: ['EVAR', 'aortic', 'infrarenal'],
      notes:
        'ILLUSTRATIVE: identity only. Diameters, lengths, sheath and IFU details must be imported from a verified manufacturer/IFU source.',
    },
    {
      name: 'Zenith Alpha Thoracic Endovascular Graft',
      manufacturer: 'Cook Medical',
      category: 'Thoracic endograft',
      subtype: 'Descending thoracic aorta',
      deviceFamily: 'Zenith Alpha',
      vascularTerritory: 'Descending thoracic aorta',
      indicationsSummary: 'Endovascular repair of descending thoracic aortic aneurysm (TEVAR).',
      tags: ['TEVAR', 'thoracic'],
      notes:
        'ILLUSTRATIVE: identity only. Sizing/IFU not included — import verified data before clinical reasoning.',
    },
    {
      name: 'Wallstent Carotid Stent',
      manufacturer: 'Boston Scientific',
      category: 'Carotid stent',
      subtype: 'Self-expanding',
      deviceFamily: 'Wallstent',
      vascularTerritory: 'Internal carotid artery',
      indicationsSummary: 'Carotid artery stenting (CAS).',
      tags: ['carotid', 'CAS'],
      notes:
        'ILLUSTRATIVE: identity only. No verified specifications included in this starter set.',
    },
  ],
};

export const SAMPLE_DEVICE_IMPORT_TEXT = JSON.stringify(SAMPLE_DEVICE_IMPORT, null, 2);
