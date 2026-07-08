// Take a look at the license at the top of the repository in the LICENSE file.

use std::{fmt::Debug, io};

use thiserror::Error;

#[derive(Error, Debug, Clone, PartialEq, Copy, Eq)]
#[non_exhaustive]
#[doc(alias = "cairo_status_t")]
pub enum Error {
    #[error("No Memory")]
    #[doc(alias = "STATUS_NO_MEMORY")]
    NoMemory,
    #[error("Invalid Restore")]
    #[doc(alias = "STATUS_INVALID_RESTORE")]
    InvalidRestore,
    #[error("Invalid Pop Group")]
    #[doc(alias = "STATUS_INVALID_POP_GROUP")]
    InvalidPopGroup,
    #[error("No Current Point")]
    #[doc(alias = "STATUS_NO_CURRENT_POINT")]
    NoCurrentPoint,
    #[error("Invalid Matrix")]
    #[doc(alias = "STATUS_INVALID_MATRIX")]
    InvalidMatrix,
    #[error("Invalid Status")]
    #[doc(alias = "STATUS_INVALID_STATUS")]
    InvalidStatus,
    #[error("Null Pointer")]
    #[doc(alias = "STATUS_NULL_POINTER")]
    NullPointer,
    #[error("Invalid String")]
    #[doc(alias = "STATUS_INVALID_STRING")]
    InvalidString,
    #[error("Invalid Path Data")]
    #[doc(alias = "STATUS_INVALID_PATH_DATA")]
    InvalidPathData,
    #[error("Cairo : Read Error")]
    #[doc(alias = "STATUS_READ_ERROR")]
    ReadError,
    #[error("Write Error")]
    #[doc(alias = "STATUS_WRITE_ERROR")]
    WriteError,
    #[error("Surface Finished")]
    #[doc(alias = "STATUS_SURFACE_FINISHED")]
    SurfaceFinished,
    #[error("Surface Type Mismatch")]
    #[doc(alias = "STATUS_SURFACE_TYPE_MISMATCH")]
    SurfaceTypeMismatch,
    #[error("Pattern Type Mismatch")]
    #[doc(alias = "STATUS_PATTERN_TYPE_MISMATCH")]
    PatternTypeMismatch,
    #[error("Invalid Content")]
    #[doc(alias = "STATUS_INVALID_CONTENT")]
    InvalidContent,
    #[error("Invalid Format")]
    #[doc(alias = "STATUS_INVALID_FORMAT")]
    InvalidFormat,
    #[error("Invalid Visual")]
    #[doc(alias = "STATUS_INVALID_VISUAL")]
    InvalidVisual,
    #[error("File Not Found")]
    #[doc(alias = "STATUS_FILE_NOT_FOUND")]
    FileNotFound,
    #[error("Invalid Dash")]
    #[doc(alias = "STATUS_INVALID_DASH")]
    InvalidDash,
    #[error("Invalid Dash Comment")]
    #[doc(alias = "STATUS_INVALID_DSC_COMMENT")]
    InvalidDscComment,
    #[error("Invalid Index")]
    #[doc(alias = "STATUS_INVALID_INDEX")]
    InvalidIndex,
    #[error("Clip Not Representable")]
    #[doc(alias = "STATUS_CLIP_NOT_REPRESENTABLE")]
    ClipNotRepresentable,
    #[error("Temp File Error")]
    #[doc(alias = "STATUS_TEMP_FILE_ERROR")]
    TempFileError,
    #[error("Invalid Stride")]
    #[doc(alias = "STATUS_INVALID_STRIDE")]
    InvalidStride,
    #[error("Font Type Mismatch")]
    #[doc(alias = "STATUS_FONT_TYPE_MISMATCH")]
    FontTypeMismatch,
    #[error("User Font Immutable")]
    #[doc(alias = "STATUS_USER_FONT_IMMUTABLE")]
    UserFontImmutable,
    #[error("User Font Error")]
    #[doc(alias = "STATUS_USER_FONT_ERROR")]
    UserFontError,
    #[error("Negative Count")]
    #[doc(alias = "STATUS_NEGATIVE_COUNT")]
    NegativeCount,
    #[error("Invalid Clusters")]
    #[doc(alias = "STATUS_INVALID_CLUSTERS")]
    InvalidClusters,
    #[error("Invalid Slant")]
    #[doc(alias = "STATUS_INVALID_SLANT")]
    InvalidSlant,
    #[error("Invalid Weight")]
    #[doc(alias = "STATUS_INVALID_WEIGHT")]
    InvalidWeight,
    #[error("Invalid Size")]
    #[doc(alias = "STATUS_INVALID_SIZE")]
    InvalidSize,
    #[error("User Font Not Implemented")]
    #[doc(alias = "STATUS_USER_FONT_NOT_IMPLEMENTED")]
    UserFontNotImplemented,
    #[error("Device Type Mismatch")]
    #[doc(alias = "STATUS_DEVICE_TYPE_MISMATCH")]
    DeviceTypeMismatch,
    #[error("Device Error")]
    #[doc(alias = "STATUS_DEVICE_ERROR")]
    DeviceError,
    #[error("Invalid Mesh Construction")]
    #[doc(alias = "STATUS_INVALID_MESH_CONSTRUCTION")]
    InvalidMeshConstruction,
    #[error("Device Finished")]
    #[doc(alias = "STATUS_DEVICE_FINISHED")]
    DeviceFinished,
    #[error("JBig2Global Missing")]
    #[doc(alias = "STATUS_J_BIG2_GLOBAL_MISSING")]
    JBig2GlobalMissing,
    #[error("PNG Error")]
    #[doc(alias = "STATUS_PNG_ERROR")]
    PngError,
    #[error("Freetype Error")]
    #[doc(alias = "STATUS_FREETYPE_ERROR")]
    FreetypeError,
    #[error("Win32Gdi Error")]
    #[doc(alias = "STATUS_WIN32_GDI_ERROR")]
    Win32GdiError,
    #[cfg(feature = "v1_16")]
    #[cfg_attr(docsrs, doc(cfg(feature = "v1_16")))]
    #[error("Tag Error")]
    #[doc(alias = "STATUS_TAG_ERROR")]
    TagError,
    #[cfg(feature = "v1_18")]
    #[cfg_attr(docsrs, doc(cfg(feature = "v1_18")))]
    #[error("Dwrite Error")]
    #[doc(alias = "STATUS_DWRITE_ERROR")]
    DwriteError,
    #[error("LastStatus")]
    #[doc(alias = "STATUS_LAST_STATUS")]
    LastStatus,
    #[error("Unknown {0}")]
    #[doc(hidden)]
    __Unknown(i32),
}
#[doc(hidden)]
impl From<Error> for ffi::cairo_status_t {
    fn from(err: Error) -> ffi::cairo_status_t {
        match err {
            Error::NoMemory => ffi::STATUS_NO_MEMORY,
            Error::InvalidRestore => ffi::STATUS_INVALID_RESTORE,
            Error::InvalidPopGroup => ffi::STATUS_INVALID_POP_GROUP,
            Error::NoCurrentPoint => ffi::STATUS_NO_CURRENT_POINT,
            Error::InvalidMatrix => ffi::STATUS_INVALID_MATRIX,
            Error::InvalidStatus => ffi::STATUS_INVALID_STATUS,
            Error::NullPointer => ffi::STATUS_NULL_POINTER,
            Error::InvalidString => ffi::STATUS_INVALID_STRING,
            Error::InvalidPathData => ffi::STATUS_INVALID_PATH_DATA,
            Error::ReadError => ffi::STATUS_READ_ERROR,
            Error::WriteError => ffi::STATUS_WRITE_ERROR,
            Error::SurfaceFinished => ffi::STATUS_SURFACE_FINISHED,
            Error::SurfaceTypeMismatch => ffi::STATUS_SURFACE_TYPE_MISMATCH,
            Error::PatternTypeMismatch => ffi::STATUS_PATTERN_TYPE_MISMATCH,
            Error::InvalidContent => ffi::STATUS_INVALID_CONTENT,
            Error::InvalidFormat => ffi::STATUS_INVALID_FORMAT,
            Error::InvalidVisual => ffi::STATUS_INVALID_VISUAL,
            Error::FileNotFound => ffi::STATUS_FILE_NOT_FOUND,
            Error::InvalidDash => ffi::STATUS_INVALID_DASH,
            Error::InvalidDscComment => ffi::STATUS_INVALID_DSC_COMMENT,
            Error::InvalidIndex => ffi::STATUS_INVALID_INDEX,
            Error::ClipNotRepresentable => ffi::STATUS_CLIP_NOT_REPRESENTABLE,
            Error::TempFileError => ffi::STATUS_TEMP_FILE_ERROR,
            Error::InvalidStride => ffi::STATUS_INVALID_STRIDE,
            Error::FontTypeMismatch => ffi::STATUS_FONT_TYPE_MISMATCH,
            Error::UserFontImmutable => ffi::STATUS_USER_FONT_IMMUTABLE,
            Error::UserFontError => ffi::STATUS_USER_FONT_ERROR,
            Error::NegativeCount => ffi::STATUS_NEGATIVE_COUNT,
            Error::InvalidClusters => ffi::STATUS_INVALID_CLUSTERS,
            Error::InvalidSlant => ffi::STATUS_INVALID_SLANT,
            Error::InvalidWeight => ffi::STATUS_INVALID_WEIGHT,
            Error::InvalidSize => ffi::STATUS_INVALID_SIZE,
            Error::UserFontNotImplemented => ffi::STATUS_USER_FONT_NOT_IMPLEMENTED,
            Error::DeviceTypeMismatch => ffi::STATUS_DEVICE_TYPE_MISMATCH,
            Error::DeviceError => ffi::STATUS_DEVICE_ERROR,
            Error::InvalidMeshConstruction => ffi::STATUS_INVALID_MESH_CONSTRUCTION,
            Error::DeviceFinished => ffi::STATUS_DEVICE_FINISHED,
            Error::JBig2GlobalMissing => ffi::STATUS_J_BIG2_GLOBAL_MISSING,
            Error::PngError => ffi::STATUS_PNG_ERROR,
            Error::FreetypeError => ffi::STATUS_FREETYPE_ERROR,
            Error::Win32GdiError => ffi::STATUS_WIN32_GDI_ERROR,
            #[cfg(feature = "v1_16")]
            Error::TagError => ffi::STATUS_TAG_ERROR,
            #[cfg(feature = "v1_18")]
            Error::DwriteError => ffi::STATUS_DWRITE_ERROR,
            Error::LastStatus => ffi::STATUS_LAST_STATUS,
            Error::__Unknown(value) => value,
        }
    }
}

#[doc(hidden)]
impl From<ffi::cairo_status_t> for Error {
    fn from(value: ffi::cairo_status_t) -> Self {
        match value {
            ffi::STATUS_NO_MEMORY => Self::NoMemory,
            ffi::STATUS_INVALID_RESTORE => Self::InvalidRestore,
            ffi::STATUS_INVALID_POP_GROUP => Self::InvalidPopGroup,
            ffi::STATUS_NO_CURRENT_POINT => Self::NoCurrentPoint,
            ffi::STATUS_INVALID_MATRIX => Self::InvalidMatrix,
            ffi::STATUS_INVALID_STATUS => Self::InvalidStatus,
            ffi::STATUS_NULL_POINTER => Self::NullPointer,
            ffi::STATUS_INVALID_STRING => Self::InvalidString,
            ffi::STATUS_INVALID_PATH_DATA => Self::InvalidPathData,
            ffi::STATUS_READ_ERROR => Self::ReadError,
            ffi::STATUS_WRITE_ERROR => Self::WriteError,
            ffi::STATUS_SURFACE_FINISHED => Self::SurfaceFinished,
            ffi::STATUS_SURFACE_TYPE_MISMATCH => Self::SurfaceTypeMismatch,
            ffi::STATUS_PATTERN_TYPE_MISMATCH => Self::PatternTypeMismatch,
            ffi::STATUS_INVALID_CONTENT => Self::InvalidContent,
            ffi::STATUS_INVALID_FORMAT => Self::InvalidFormat,
            ffi::STATUS_INVALID_VISUAL => Self::InvalidVisual,
            ffi::STATUS_FILE_NOT_FOUND => Self::FileNotFound,
            ffi::STATUS_INVALID_DASH => Self::InvalidDash,
            ffi::STATUS_INVALID_DSC_COMMENT => Self::InvalidDscComment,
            ffi::STATUS_INVALID_INDEX => Self::InvalidIndex,
            ffi::STATUS_CLIP_NOT_REPRESENTABLE => Self::ClipNotRepresentable,
            ffi::STATUS_TEMP_FILE_ERROR => Self::TempFileError,
            ffi::STATUS_INVALID_STRIDE => Self::InvalidStride,
            ffi::STATUS_FONT_TYPE_MISMATCH => Self::FontTypeMismatch,
            ffi::STATUS_USER_FONT_IMMUTABLE => Self::UserFontImmutable,
            ffi::STATUS_USER_FONT_ERROR => Self::UserFontError,
            ffi::STATUS_NEGATIVE_COUNT => Self::NegativeCount,
            ffi::STATUS_INVALID_CLUSTERS => Self::InvalidClusters,
            ffi::STATUS_INVALID_SLANT => Self::InvalidSlant,
            ffi::STATUS_INVALID_WEIGHT => Self::InvalidWeight,
            ffi::STATUS_INVALID_SIZE => Self::InvalidSize,
            ffi::STATUS_USER_FONT_NOT_IMPLEMENTED => Self::UserFontNotImplemented,
            ffi::STATUS_DEVICE_TYPE_MISMATCH => Self::DeviceTypeMismatch,
            ffi::STATUS_DEVICE_ERROR => Self::DeviceError,
            ffi::STATUS_INVALID_MESH_CONSTRUCTION => Self::InvalidMeshConstruction,
            ffi::STATUS_DEVICE_FINISHED => Self::DeviceFinished,
            ffi::STATUS_J_BIG2_GLOBAL_MISSING => Self::JBig2GlobalMissing,
            ffi::STATUS_PNG_ERROR => Self::PngError,
            ffi::STATUS_FREETYPE_ERROR => Self::FreetypeError,
            ffi::STATUS_WIN32_GDI_ERROR => Self::Win32GdiError,
            #[cfg(feature = "v1_16")]
            ffi::STATUS_TAG_ERROR => Self::TagError,
            #[cfg(feature = "v1_18")]
            ffi::STATUS_DWRITE_ERROR => Self::DwriteError,
            ffi::STATUS_LAST_STATUS => Self::LastStatus,
            value => Self::__Unknown(value),
        }
    }
}

#[derive(Error, Debug)]
pub enum IoError {
    #[error("Cairo error: {0}")]
    Cairo(#[from] Error),
    #[error("IO error: {0}")]
    Io(#[from] io::Error),
}

#[derive(Error, Debug)]
pub enum BorrowError {
    #[error("Failed to borrow with Cairo error: {0}")]
    Cairo(#[from] crate::Error),
    #[error("Can't get exclusive access")]
    NonExclusive,
}

pub type Result<T> = std::result::Result<T, Error>;
