import { isWithinNightWindow } from "./night-service-pricing";

export type PersonalNightConfig = {
  enabled: boolean;
  startTime: string;
  endTime: string;
} | undefined;

export type PreviousPersonalRate = {
  serviceId: number;
  hourlyRate: number;
  isNightShift: boolean;
} | undefined;

export function resolvePersonalShiftPricing(input: {
  now: Date;
  previous: PreviousPersonalRate;
  serviceId: number;
  serviceHourlyRate: number;
  serviceNightHourlyRate: number | null;
  facilityServiceId: number | null;
  useFacilityRates: boolean;
  nightConfig: PersonalNightConfig;
}) {
  const eligibleForFacilityNightRate = input.useFacilityRates && input.facilityServiceId !== null;
  const isNightShift = input.previous
    ? input.previous.isNightShift === true
    : Boolean(eligibleForFacilityNightRate && input.nightConfig?.enabled &&
      isWithinNightWindow(input.now, input.nightConfig.startTime, input.nightConfig.endTime));
  const sameService = input.previous?.serviceId === input.serviceId;
  const useNightRate = Boolean(eligibleForFacilityNightRate && isNightShift && input.nightConfig?.enabled);
  const hourlyRate = sameService
    ? input.previous!.hourlyRate
    : useNightRate
      ? input.serviceNightHourlyRate ?? 0
      : input.serviceHourlyRate;
  return { isNightShift, sameService, useNightRate, hourlyRate };
}
