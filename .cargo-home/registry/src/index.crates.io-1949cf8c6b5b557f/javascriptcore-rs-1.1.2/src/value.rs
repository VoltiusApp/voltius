use crate::Context;
use crate::Value;
use crate::ValueExt;
use glib::ffi::GBytes;
use glib::object::IsA;
use glib::translate::*;
use std::ffi::c_void;
use std::slice;

impl Value {
  #[cfg(any(feature = "v2_38", docsrs))]
  #[cfg_attr(docsrs, doc(cfg(feature = "v2_38")))]
  #[doc(alias = "jsc_value_new_array_buffer")]
  pub fn new_array_buffer(context: &impl IsA<Context>, data: glib::Bytes) -> Option<Value> {
    let len = data.len();
    let ptr: *mut GBytes = data.to_glib_full();

    unsafe extern "C" fn destroy_notify(user_data: *mut c_void) {
      let data: glib::Bytes = from_glib_full(user_data as *mut GBytes);
      drop(data);
    }

    unsafe {
      from_glib_full(ffi::jsc_value_new_array_buffer(
        context.as_ref().to_glib_none().0,
        ptr as _,
        len,
        Some(destroy_notify),
        ptr as _,
      ))
    }
  }
}

pub trait ValueExtManual: 'static {
  #[cfg(any(feature = "v2_38", docsrs))]
  #[cfg_attr(docsrs, doc(cfg(feature = "v2_38")))]
  #[doc(alias = "jsc_value_array_buffer_get_data")]
  fn array_buffer_get_data(&self) -> &[u8];

  #[cfg(any(feature = "v2_38", docsrs))]
  #[cfg_attr(docsrs, doc(cfg(feature = "v2_38")))]
  #[doc(alias = "jsc_value_typed_array_get_data")]
  fn typed_array_get_data(&self) -> TypedArrayData;
}

impl<O: IsA<Value>> ValueExtManual for O {
  #[cfg(any(feature = "v2_38", docsrs))]
  #[cfg_attr(docsrs, doc(cfg(feature = "v2_38")))]
  fn array_buffer_get_data(&self) -> &[u8] {
    unsafe {
      let mut len = 0;
      let ptr = ffi::jsc_value_array_buffer_get_data(self.as_ref().to_glib_none().0, &mut len);
      if ptr.is_null() || len == 0 {
        &[]
      } else {
        slice::from_raw_parts(ptr as *const u8, len)
      }
    }
  }

  #[cfg(any(feature = "v2_38", docsrs))]
  #[cfg_attr(docsrs, doc(cfg(feature = "v2_38")))]
  fn typed_array_get_data(&self) -> TypedArrayData {
    use crate::TypedArrayType::*;
    unsafe {
      let mut len = 0;
      let ptr = ffi::jsc_value_typed_array_get_data(self.as_ref().to_glib_none().0, &mut len);
      if ptr.is_null() || len == 0 {
        TypedArrayData::None
      } else {
        match self.typed_array_get_type() {
          None => TypedArrayData::None,
          Int8 => TypedArrayData::Int8(slice::from_raw_parts(ptr as *const i8, len)),
          Int16 => TypedArrayData::Int16(slice::from_raw_parts(ptr as *const i16, len)),
          Int32 => TypedArrayData::Int32(slice::from_raw_parts(ptr as *const i32, len)),
          Int64 => TypedArrayData::Int64(slice::from_raw_parts(ptr as *const i64, len)),
          Uint8 => TypedArrayData::Uint8(slice::from_raw_parts(ptr as *const u8, len)),
          Uint8Clamped => {
            TypedArrayData::Uint8Clamped(slice::from_raw_parts(ptr as *const u8, len))
          }
          Uint16 => TypedArrayData::Uint16(slice::from_raw_parts(ptr as *const u16, len)),
          Uint32 => TypedArrayData::Uint32(slice::from_raw_parts(ptr as *const u32, len)),
          Uint64 => TypedArrayData::Uint64(slice::from_raw_parts(ptr as *const u64, len)),
          Float32 => TypedArrayData::Float32(slice::from_raw_parts(ptr as *const f32, len)),
          Float64 => TypedArrayData::Float64(slice::from_raw_parts(ptr as *const f64, len)),
          __Unknown(_) => TypedArrayData::None,
        }
      }
    }
  }
}

#[cfg(any(feature = "v2_38", docsrs))]
#[cfg_attr(docsrs, doc(cfg(feature = "v2_38")))]
#[derive(Debug, Clone, Copy)]
#[non_exhaustive]
pub enum TypedArrayData<'a> {
  #[doc(alias = "JSC_TYPED_ARRAY_NONE")]
  None,
  #[doc(alias = "JSC_TYPED_ARRAY_INT8")]
  Int8(&'a [i8]),
  #[doc(alias = "JSC_TYPED_ARRAY_INT16")]
  Int16(&'a [i16]),
  #[doc(alias = "JSC_TYPED_ARRAY_INT32")]
  Int32(&'a [i32]),
  #[doc(alias = "JSC_TYPED_ARRAY_INT64")]
  Int64(&'a [i64]),
  #[doc(alias = "JSC_TYPED_ARRAY_UINT8")]
  Uint8(&'a [u8]),
  #[doc(alias = "JSC_TYPED_ARRAY_UINT8_CLAMPED")]
  Uint8Clamped(&'a [u8]),
  #[doc(alias = "JSC_TYPED_ARRAY_UINT16")]
  Uint16(&'a [u16]),
  #[doc(alias = "JSC_TYPED_ARRAY_UINT32")]
  Uint32(&'a [u32]),
  #[doc(alias = "JSC_TYPED_ARRAY_UINT64")]
  Uint64(&'a [u64]),
  #[doc(alias = "JSC_TYPED_ARRAY_FLOAT32")]
  Float32(&'a [f32]),
  #[doc(alias = "JSC_TYPED_ARRAY_FLOAT64")]
  Float64(&'a [f64]),
}
