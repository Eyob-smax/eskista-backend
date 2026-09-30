import { AgreementStatus, DocumentStatus, VendorKind, VerificationStatus } from '@prisma/client';
import { newClaimCode } from '../talent/admin-talent.service';
import { vendorVerificationBlockers } from './admin-vendors.service';

describe('vendorVerificationBlockers', () => {
  const ready = {
    status: VerificationStatus.PENDING_REVIEW,
    kind: VendorKind.INDIVIDUAL,
    documents: [{ type: 'FAYDA_ID', status: DocumentStatus.PENDING }],
    agreementStatus: AgreementStatus.UNDER_REVIEW,
  };

  it('lets a complete individual through', () => {
    expect(vendorVerificationBlockers(ready)).toEqual([]);
  });

  it('asks a company for its registration or license', () => {
    expect(vendorVerificationBlockers({ ...ready, kind: VendorKind.COMPANY })).toEqual([
      'No business registration or license uploaded',
    ]);
  });

  it('needs the signed vendor agreement uploaded', () => {
    expect(
      vendorVerificationBlockers({ ...ready, agreementStatus: AgreementStatus.AWAITING_UPLOAD }),
    ).toEqual(['The signed vendor agreement has not been uploaded']);
  });

  it('ignores rejected documents', () => {
    expect(
      vendorVerificationBlockers({
        ...ready,
        documents: [{ type: 'FAYDA_ID', status: DocumentStatus.REJECTED }],
      }),
    ).toEqual(['No ID document uploaded']);
  });

  it('only verifies a vendor awaiting it', () => {
    expect(
      vendorVerificationBlockers({ ...ready, status: VerificationStatus.VERIFIED })[0],
    ).toMatch(/not awaiting/);
  });
});

describe('newClaimCode', () => {
  it('is two readable groups of four', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(newClaimCode()).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    }
  });
});
