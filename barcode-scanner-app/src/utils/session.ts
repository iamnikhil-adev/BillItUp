import type { BillRecord } from './db';

let daybookDate: string | null = null;
let dashboardFilter: string | null = null;
let dashboardDate: string | null = null;
let dashboardSearch: string | null = null;
let dashboardScrollY: number | null = null;
let cachedBills: BillRecord[] | null = null;

export const setCachedBills = (bills: BillRecord[]) => {
  cachedBills = bills;
};

export const getCachedBills = (): BillRecord[] | null => {
  return cachedBills;
};

export const setDaybookSessionDate = (date: string | null) => {
  daybookDate = date;
};

export const getDaybookSessionDate = (): string | null => {
  return daybookDate;
};

export const setDashboardSession = (filter: string | null, date: string | null, search?: string | null, scrollY?: number | null) => {
  dashboardFilter = filter;
  dashboardDate = date;
  if (search !== undefined) dashboardSearch = search;
  if (scrollY !== undefined) dashboardScrollY = scrollY;
};

export const getDashboardSession = () => {
  return { filter: dashboardFilter, date: dashboardDate, search: dashboardSearch, scrollY: dashboardScrollY };
};

export const clearDashboardSession = () => {
  dashboardFilter = null;
  dashboardDate = null;
  dashboardSearch = null;
  dashboardScrollY = null;
};

