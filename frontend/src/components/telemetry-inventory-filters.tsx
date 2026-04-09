"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface TelemetryInventoryFiltersProps {
  searchText: string;
  onSearchTextChange: (value: string) => void;
  subsystemOptions: string[];
  selectedSubsystem: string;
  onSelectedSubsystemChange: (value: string) => void;
  anomalousOnly: boolean;
  onAnomalousOnlyChange: (value: boolean) => void;
  hasDataFilter: "all" | "has_data" | "no_data";
  onHasDataFilterChange: (value: "all" | "has_data" | "no_data") => void;
  sortKey: "operational" | "name" | "subsystem" | "last_updated" | "state";
  onSortKeyChange: (
    value: "operational" | "name" | "subsystem" | "last_updated" | "state"
  ) => void;
}

export function TelemetryInventoryFilters({
  searchText,
  onSearchTextChange,
  subsystemOptions,
  selectedSubsystem,
  onSelectedSubsystemChange,
  anomalousOnly,
  onAnomalousOnlyChange,
  hasDataFilter,
  onHasDataFilterChange,
  sortKey,
  onSortKeyChange,
}: TelemetryInventoryFiltersProps) {
  return (
    <div className="grid gap-4 rounded-lg border p-4 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
      <div className="space-y-2">
        <Label htmlFor="telemetry-search">Search</Label>
        <Input
          id="telemetry-search"
          value={searchText}
          onChange={(event) => onSearchTextChange(event.target.value)}
          placeholder="Name, alias, description, namespace"
        />
      </div>
      <div className="space-y-2">
        <Label>Subsystem</Label>
        <Select
          value={selectedSubsystem}
          onValueChange={onSelectedSubsystemChange}
        >
          <SelectTrigger>
            <SelectValue placeholder="All subsystems" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All subsystems</SelectItem>
            {subsystemOptions.map((subsystem) => (
              <SelectItem key={subsystem} value={subsystem}>
                {subsystem}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Data</Label>
        <Select
          value={hasDataFilter}
          onValueChange={(value: "all" | "has_data" | "no_data") =>
            onHasDataFilterChange(value)
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All channels</SelectItem>
            <SelectItem value="has_data">Has data</SelectItem>
            <SelectItem value="no_data">No data</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Sort</Label>
        <Select
          value={sortKey}
          onValueChange={(
            value: "operational" | "name" | "subsystem" | "last_updated" | "state"
          ) => onSortKeyChange(value)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="operational">Operational</SelectItem>
            <SelectItem value="name">Name</SelectItem>
            <SelectItem value="subsystem">Subsystem</SelectItem>
            <SelectItem value="last_updated">Last updated</SelectItem>
            <SelectItem value="state">State</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <label className="flex items-center gap-2 lg:col-span-4">
        <Checkbox
          checked={anomalousOnly}
          onCheckedChange={(checked) => onAnomalousOnlyChange(!!checked)}
        />
        <span className="text-sm">Anomalous only</span>
      </label>
    </div>
  );
}
