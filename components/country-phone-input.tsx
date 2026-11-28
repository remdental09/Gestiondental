"use client";

import { useEffect, useRef, useState } from "react";
import { composePhoneNumber, DEFAULT_PHONE_COUNTRY, PHONE_COUNTRIES, splitPhoneNumber } from "@/lib/phone-countries";
import { Input } from "@/components/ui/input";

export function CountryPhoneInput({ value, onChange, inputId, testId, placeholder = "9 1234 5678", invalid = false }: {
  value: string;
  onChange: (value: string) => void;
  inputId?: string;
  testId?: string;
  placeholder?: string;
  invalid?: boolean;
}) {
  const initial = splitPhoneNumber(value);
  const [country, setCountry] = useState(initial.country.code || DEFAULT_PHONE_COUNTRY.code);
  const [nationalNumber, setNationalNumber] = useState(initial.nationalNumber);
  const lastEmittedValue = useRef(value);

  useEffect(() => {
    if (value === lastEmittedValue.current) return;
    const parsed = splitPhoneNumber(value);
    setCountry(parsed.country.code);
    setNationalNumber(parsed.nationalNumber);
    lastEmittedValue.current = value;
  }, [value]);

  const emit = (countryCode: string, national: string) => {
    const nextValue = composePhoneNumber(countryCode, national);
    lastEmittedValue.current = nextValue;
    onChange(nextValue);
  };

  return <div className="flex min-w-0 gap-2">
    <select aria-label="País y código telefónico" autoComplete="tel-country-code" value={country} onChange={event => {
      const nextCountry = event.target.value;
      setCountry(nextCountry);
      emit(nextCountry, nationalNumber);
    }} className="h-10 w-[46%] min-w-0 rounded-md border border-input bg-white px-2 text-xs sm:w-[44%] sm:text-sm" data-testid={testId ? `${testId}-country` : undefined}>
      {PHONE_COUNTRIES.map(item => <option key={item.code} value={item.code}>{item.name} ({item.dialCode})</option>)}
    </select>
    <Input id={inputId} type="tel" inputMode="tel" autoComplete="tel-national" value={nationalNumber} maxLength={20} onChange={event => {
      const raw = event.target.value;
      if (raw.trim().startsWith("+") || raw.trim().startsWith("00")) {
        const parsed = splitPhoneNumber(raw);
        if (parsed.nationalNumber !== raw) {
          setCountry(parsed.country.code);
          setNationalNumber(parsed.nationalNumber);
          emit(parsed.country.code, parsed.nationalNumber);
          return;
        }
      }
      setNationalNumber(raw);
      emit(country, raw);
    }} placeholder={placeholder} aria-label="Número de teléfono" aria-invalid={invalid} data-testid={testId} className="w-0 min-w-0 flex-1" />
  </div>;
}
