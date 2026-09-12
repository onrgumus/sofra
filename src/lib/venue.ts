import type { OfficeVenue } from '../notify/invite';
import type { Office } from '../store/types';

/** The invite layer only needs the physical facts about an office. */
export function toVenue(office: Office): OfficeVenue {
  return {
    officeId: office.id,
    displayName: office.displayName,
    timeZone: office.timeZone,
    meetingPoint: office.meetingPoint,
  };
}
