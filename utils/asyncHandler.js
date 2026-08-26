// Bungkus route handler async supaya kalau ada Promise yang reject (misal
// query DB gagal), errornya otomatis diteruskan ke error-handler Express
// (lewat next(err)) alih-alih bikin request nge-hang tanpa respons.
module.exports = function asyncHandler(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
