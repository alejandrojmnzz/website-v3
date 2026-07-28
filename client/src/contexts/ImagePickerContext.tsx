import { createContext, useContext, useRef } from "react";
import type { MediaDoctype } from "@shared/media-doctype";

export interface ImagePickerTarget {
  arrayPath?: string;
  index?: number;
  srcField?: string;
  fieldPath?: string;
  label?: string;
  currentSrc: string;
  currentAlt: string;
  currentRegistryId?: string;
  tagFilter?: string;
  clearFieldOnly?: boolean;
  _fromImageClick?: boolean;
  _oldRegistryId?: string;
  _oldSrc?: string;
  /** Restrict picker browse/upload; defaults to image when omitted. */
  doctype?: MediaDoctype;
}

interface OpenImagePickerOptions {
  id: string;
  alt: string;
  currentRegistryId?: string;
  fieldContext?: { fieldPath: string } | { arrayPath: string; index: number; srcField: string };
}

interface ImagePickerRegistration {
  openPicker: (target: ImagePickerTarget) => void;
}

interface ImagePickerContextValue {
  registerPicker: (reg: ImagePickerRegistration | null) => void;
  openImagePicker: (options: OpenImagePickerOptions) => void;
}

const ImagePickerContext = createContext<ImagePickerContextValue | null>(null);

export function ImagePickerProvider({ children }: { children: React.ReactNode }) {
  const registrationRef = useRef<ImagePickerRegistration | null>(null);

  const registerPicker = (reg: ImagePickerRegistration | null) => {
    registrationRef.current = reg;
  };

  const openImagePicker = (options: OpenImagePickerOptions) => {
    if (!registrationRef.current) return;

    const { id, alt, currentRegistryId, fieldContext } = options;

    const baseTarget: ImagePickerTarget = {
      currentSrc: id,
      currentAlt: alt,
      currentRegistryId: currentRegistryId,
      _fromImageClick: true,
      _oldRegistryId: currentRegistryId,
      _oldSrc: id,
    };

    if (fieldContext && "fieldPath" in fieldContext) {
      baseTarget.fieldPath = fieldContext.fieldPath;
    } else if (fieldContext && "arrayPath" in fieldContext) {
      baseTarget.arrayPath = fieldContext.arrayPath;
      baseTarget.index = fieldContext.index;
      baseTarget.srcField = fieldContext.srcField;
    }

    registrationRef.current.openPicker(baseTarget);
  };

  return (
    <ImagePickerContext.Provider value={{ registerPicker, openImagePicker }}>
      {children}
    </ImagePickerContext.Provider>
  );
}

export function useImagePickerContext(): ImagePickerContextValue | null {
  return useContext(ImagePickerContext);
}
