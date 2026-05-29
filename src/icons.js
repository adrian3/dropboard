"use client";

import React from "react";
import { Cog6ToothIcon, EyeIcon, EyeSlashIcon, FunnelIcon } from "@heroicons/react/24/outline";

function withIconDefaults(Icon) {
  return function DropBoardIcon({ className, ...props }) {
    return <Icon aria-hidden="true" className={className} {...props} />;
  };
}

export const DropBoardFilterIcon = withIconDefaults(FunnelIcon);
export const DropBoardHideIcon = withIconDefaults(EyeSlashIcon);
export const DropBoardSettingsIcon = withIconDefaults(Cog6ToothIcon);
export const DropBoardShowIcon = withIconDefaults(EyeIcon);
