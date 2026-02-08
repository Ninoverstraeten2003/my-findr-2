"use client";

import { useCallback, useEffect, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import {
  MapPin,
  Circle,
  Star,
  Flower2,
  Car,
  Bus,
  User,
  Camera,
  Smartphone,
  Laptop,
  Key,
  TreePine,
  Baby,
  Bike,
  Plus,
  Pencil,
  Trash2,
  Save,
  Share2,
  RotateCcw,
  Check,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useSettings, defaultSettings } from "@/lib/use-settings";
import { getAdvertisementKey } from "@/lib/decrypt-payload";
import { pluralize } from "@/lib/app-utils";
import type { Device, AppSettings } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTheme } from "next-themes";


const iconMap: Record<string, LucideIcon> = {
  MapPin,
  Circle,
  Star,
  Flower2,
  Car,
  Bus,
  User,
  Camera,
  Smartphone,
  Laptop,
  Key,
  TreePine,
  Baby,
  Bike,
};

const iconNames = Object.keys(iconMap);

const defaultNewDevice: Device = {
  order: 0,
  id: "",
  name: "",
  privateKey: "",
  advertismentKey: "",
  icon: "MapPin",
  hexColor: "#0ea5e9",
  lastSeen: null,
  battery: "Unknown",
};

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

export default function SettingsView() {
  const { toast } = useToast();
  const { theme, setTheme } = useTheme();
  const [storeSettings, updateStoredSettings, deleteStoredSettings] =
    useSettings();
  const [settingsForm, setSettingsForm] = useState<AppSettings>(storeSettings);
  const [deviceEditForm, setDeviceEditForm] = useState<Device>(defaultNewDevice);
  const [showDeviceForm, setShowDeviceForm] = useState(false);
  
  // Share dialog state
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [isGeneratingLink, setIsGeneratingLink] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [isReset, setIsReset] = useState(false);

  // Sync storeSettings on mount
  useEffect(() => {
    setSettingsForm(storeSettings);
    // Sync theme from stored settings
    // We check if it exists to avoid overwriting with undefined
    if (storeSettings.appTheme) {
      setTheme(storeSettings.appTheme);
    }
  }, [storeSettings]);

  const validateDevice = useCallback(
    async (device: Device) => {
      if (device.name === "" || device.privateKey === "") {
        toast({
          title: "Missing fields",
          description: "Name and private key are required",
          variant: "destructive",
        });
        return false;
      }

      let advertismentKey = "";
      try {
        advertismentKey = await getAdvertisementKey(device.privateKey);
      } catch {
        // ignore
      }

      if (advertismentKey === "") {
        toast({
          title: "Invalid key",
          description: "Check your private key format",
          variant: "destructive",
        });
        return false;
      }

      if (device.name.length > 20) {
        toast({
          title: "Name too long",
          description: "Name can be maximum 20 characters",
          variant: "destructive",
        });
        return false;
      }
      return true;
    },
    [toast]
  );

  const saveSettings = useCallback(() => {
    if (settingsForm.devices.length === 0) {
      toast({
        title: "No devices",
        description: "At least one device is required",
        variant: "destructive",
      });
      return;
    }
    if (!settingsForm.apiURL) {
      toast({
        title: "Missing API URL",
        description: "API URL cannot be empty",
        variant: "destructive",
      });
      return;
    }
    updateStoredSettings(settingsForm);
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
  }, [settingsForm, updateStoredSettings, toast]);

  const addDevice = useCallback(
    async (device: Device) => {
      if (!(await validateDevice(device))) return;
      device.id = uuidv4();
      const updatedDevices = [...settingsForm.devices, device];
      const updated = { ...settingsForm, devices: updatedDevices };
      setSettingsForm(updated);
      updateStoredSettings(updated);
      toast({ title: "Device added" });
      setDeviceEditForm(defaultNewDevice);
      setShowDeviceForm(false);
    },
    [validateDevice, settingsForm, updateStoredSettings, toast]
  );

  const updateDevice = useCallback(
    async (device: Device) => {
      if (!(await validateDevice(device))) return;
      const updatedDevices = settingsForm.devices.map((d) =>
        d.id === device.id ? device : d
      );
      const updated = { ...settingsForm, devices: updatedDevices };
      setSettingsForm(updated);
      updateStoredSettings(updated);
      setDeviceEditForm(defaultNewDevice);
      setShowDeviceForm(false);
    },
    [validateDevice, settingsForm, updateStoredSettings]
  );

  const removeDevice = useCallback(
    (device: Device) => {
      const updatedDevices = settingsForm.devices.filter(
        (d) => d.id !== device.id
      );
      const updated = { ...settingsForm, devices: updatedDevices };
      setSettingsForm(updated);
      updateStoredSettings(updated);
      toast({ title: "Device removed" });
    },
    [settingsForm, updateStoredSettings, toast]
  );

  const editDevice = useCallback((device: Device) => {
    setDeviceEditForm(device);
    setShowDeviceForm(true);
  }, []);

  const clearSettings = useCallback(() => {
    deleteStoredSettings();
    setSettingsForm(defaultSettings);
    setIsReset(true);
    setTimeout(() => setIsReset(false), 2000);
  }, [deleteStoredSettings]);

  const generateShareLink = useCallback(async () => {
    setIsGeneratingLink(true);
    try {
      const { encryptSettings } = await import("@/lib/secure-share");
      const hashParams = await encryptSettings(settingsForm);
      const url = `${window.location.origin}${window.location.pathname}${hashParams}`;
      setShareUrl(url);
      setShowShareDialog(true);
    } catch (e) {
      console.error("Share settings error:", e);
      toast({ 
        title: "Encryption failed", 
        description: "Could not generate secure link. Check console for details.", 
        variant: "destructive" 
      });
    } finally {
      setIsGeneratingLink(false);
    }
  }, [settingsForm, toast]);

  const copyShareLink = useCallback(() => {
    navigator.clipboard.writeText(shareUrl);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  }, [shareUrl]);

  return (
    <div className="flex flex-col gap-6 p-4 md:p-8 max-w-2xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Settings
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure your tracking API and manage devices.
        </p>
      </div>

      {/* Connection Settings */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Connection</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="apiUrl">API URL</Label>
            <Input
              id="apiUrl"
              value={settingsForm.apiURL}
              placeholder="https://your-api.example.com"
              onChange={(e) =>
                setSettingsForm({ ...settingsForm, apiURL: e.target.value })
              }
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                value={settingsForm.username}
                placeholder="username"
                onChange={(e) =>
                  setSettingsForm({
                    ...settingsForm,
                    username: e.target.value,
                  })
                }
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={settingsForm.password}
                placeholder="password"
                onChange={(e) =>
                  setSettingsForm({
                    ...settingsForm,
                    password: e.target.value,
                  })
                }
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Preferences */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Preferences</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <Label>History Length</Label>
              <Badge variant="secondary">
                {pluralize(settingsForm.days, "Day")}
              </Badge>
            </div>
            <Slider
              value={[settingsForm.days]}
              onValueChange={(value) =>
                setSettingsForm({ ...settingsForm, days: value[0] })
              }
              min={1}
              max={7}
              step={1}
              className="w-full"
            />
          </div>
          <div className="flex flex-col gap-3">
            <Label>App Theme</Label>
            <Select 
              value={settingsForm.appTheme || "system"} 
              onValueChange={(value: "light" | "dark" | "system") => {
                setTheme(value);
                setSettingsForm({ ...settingsForm, appTheme: value });
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a theme" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">System (Auto)</SelectItem>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="dark">Dark</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-3">
            <Label>Map Theme</Label>
            <Select
              value={settingsForm.mapTheme || "system"}
              onValueChange={(value: any) =>
                setSettingsForm({ ...settingsForm, mapTheme: value })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a theme" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">System (Auto)</SelectItem>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="dark">Dark</SelectItem>
                <SelectItem value="satellite">Satellite</SelectItem>
                <SelectItem value="streets">Streets</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Separator />
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="showHistory">Show History</Label>
              <span className="text-xs text-muted-foreground">
                Display location trail on the map
              </span>
            </div>
            <Switch
              id="showHistory"
              checked={settingsForm.showHistory ?? true}
              onCheckedChange={(checked) =>
                setSettingsForm({ ...settingsForm, showHistory: checked })
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Devices */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">
              Devices
              {settingsForm.devices.length > 0 && (
                <span className="text-muted-foreground font-normal ml-2">
                  ({settingsForm.devices.length})
                </span>
              )}
            </CardTitle>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setDeviceEditForm(defaultNewDevice);
                setShowDeviceForm(true);
              }}
            >
              <Plus className="h-4 w-4 mr-1" />
              Add
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {settingsForm.devices.length === 0 && !showDeviceForm && (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No devices added yet. Click Add to get started.
            </div>
          )}

          {settingsForm.devices.map((device) => {
            const IconComp = iconMap[device.icon] || MapPin;
            return (
              <div
                key={device.id}
                className="flex items-center gap-3 p-3 rounded-lg bg-secondary/50 border border-border"
              >
                <div
                  className="flex items-center justify-center w-9 h-9 rounded-md"
                  style={{ backgroundColor: device.hexColor + "22" }}
                >
                  <IconComp
                    className="h-4 w-4"
                    style={{ color: device.hexColor }}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm text-foreground truncate">
                    {device.name}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={() => editDevice(device)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    <span className="sr-only">Edit device</span>
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => removeDevice(device)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span className="sr-only">Remove device</span>
                  </Button>
                </div>
              </div>
            );
          })}

          {/* Device Add/Edit Form */}
          {showDeviceForm && (
            <>
              <Separator />
              <div className="flex flex-col gap-4 p-4 rounded-lg border border-border bg-card">
                <div className="text-sm font-medium text-foreground">
                  {deviceEditForm.id ? "Edit Device" : "New Device"}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="deviceName">Name</Label>
                    <Input
                      id="deviceName"
                      value={deviceEditForm.name}
                      placeholder="My Tag"
                      onChange={(e) =>
                        setDeviceEditForm({
                          ...deviceEditForm,
                          name: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="deviceColor">Color</Label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        id="deviceColor"
                        value={deviceEditForm.hexColor}
                        onChange={(e) =>
                          setDeviceEditForm({
                            ...deviceEditForm,
                            hexColor: e.target.value,
                          })
                        }
                        className="h-9 w-12 rounded-md border border-input cursor-pointer bg-transparent"
                      />
                      <Input
                        value={deviceEditForm.hexColor}
                        onChange={(e) =>
                          setDeviceEditForm({
                            ...deviceEditForm,
                            hexColor: e.target.value,
                          })
                        }
                        className="font-mono text-xs"
                      />
                    </div>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="privateKey">Base64 Private Key</Label>
                  <Input
                    id="privateKey"
                    type="password"
                    value={deviceEditForm.privateKey}
                    placeholder="Enter your base64 private key"
                    onChange={(e) =>
                      setDeviceEditForm({
                        ...deviceEditForm,
                        privateKey: e.target.value,
                      })
                    }
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Icon</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {iconNames.map((name) => {
                      const Ic = iconMap[name];
                      const isSelected = deviceEditForm.icon === name;
                      return (
                        <button
                          key={name}
                          type="button"
                          onClick={() =>
                            setDeviceEditForm({
                              ...deviceEditForm,
                              icon: name,
                            })
                          }
                          className={`flex items-center justify-center w-9 h-9 rounded-md border transition-colors ${
                            isSelected
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border bg-secondary/30 text-muted-foreground hover:bg-secondary hover:text-foreground"
                          }`}
                        >
                          <Ic className="h-4 w-4" />
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={
                      deviceEditForm.id
                        ? () => updateDevice(deviceEditForm)
                        : () => addDevice(deviceEditForm)
                    }
                    className="flex-1"
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    {deviceEditForm.id ? "Update" : "Add Device"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setDeviceEditForm(defaultNewDevice);
                      setShowDeviceForm(false);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-2">
        <Button 
          onClick={saveSettings} 
          className="flex-1 transition-all duration-200"
          variant={isSaved ? "outline" : "default"}
        >
          {isSaved ? (
            <>
              <Check className="h-4 w-4 mr-1.5" />
              Saved!
            </>
          ) : (
            <>
              <Save className="h-4 w-4 mr-1.5" />
              Save Settings
            </>
          )}
        </Button>
        <Button 
          variant="outline" 
          onClick={generateShareLink} 
          className="flex-1 bg-transparent"
          disabled={isGeneratingLink}
        >
          {isGeneratingLink ? (
            <span className="animate-pulse">Generating...</span>
          ) : (
            <>
              <Share2 className="h-4 w-4 mr-1.5" />
              Share Securely
            </>
          )}
        </Button>
        <Button
          variant="outline"
          onClick={clearSettings}
          className="flex-1 text-destructive hover:text-destructive border-destructive/30 hover:bg-destructive/10 bg-transparent"
        >
          {isReset ? (
            <>
              <Check className="h-4 w-4 mr-1.5" />
              Reset
            </>
          ) : (
            <>
              <RotateCcw className="h-4 w-4 mr-1.5" />
              Reset
            </>
          )}
        </Button>
      </div>

      {/* Share Dialog */}
      <Dialog open={showShareDialog} onOpenChange={setShowShareDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Share Settings Securely</DialogTitle>
            <DialogDescription>
              Anyone with this link can view your settings and keys. The key is in the link and is never sent to our servers.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center space-x-2">
            <div className="grid flex-1 gap-2">
              <Label htmlFor="link" className="sr-only">
                Link
              </Label>
              <Input
                id="link"
                defaultValue={shareUrl}
                readOnly
              />
            </div>
            <Button
              type="submit"
              size="sm"
              onClick={copyShareLink}
              className="px-3"
              disabled={isCopied}
            >
              <span className="sr-only">Copy</span>
              {isCopied ? (
                <Check className="h-4 w-4" />
              ) : (
                <Share2 className="h-4 w-4" />
              )}
            </Button>
          </div>
          <DialogFooter className="sm:justify-start">
             <div className="text-[0.8rem] text-muted-foreground w-full">
               Copy and share this link carefully. It expires if you change your keys.
             </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
