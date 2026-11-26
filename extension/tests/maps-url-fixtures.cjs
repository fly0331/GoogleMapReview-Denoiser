const previousPlace = "0x3442a6d9076ea2e7:0xe3e9c03d5b3f1258";
const selectedPlace = "0x3442a7ef22bd6e69:0x36d0705426a9d80a";
const placePath = "https://www.google.com/maps/place/IDK+Caf%C3%A9+%26+Restaurant";

// Complete the previously observed identity fields with well-formed group spans.
function dualPlaceUrl(previous, selected, { reviews = false } = {}) {
  const previousGroup = `!1m9!3m8!1s${previous}!2zprev!8m2!3d25.05!4d121.53!9m1!1b1!16s%2Fg%2Fprev`;
  const reviewFlag = reviews ? "!9m1!1b1" : "";
  const selectedGroup = `!3m${reviews ? 7 : 5}!1s${selected}!8m2!3d25.06!4d121.54${reviewFlag}!16s%2Fg%2Fselected`;
  return `${placePath}/data=!4m${reviews ? 18 : 16}${previousGroup}${selectedGroup}`;
}

const observedDualPlaceUrl = dualPlaceUrl(previousPlace, selectedPlace);

const hotpotPlace = "0x3442a716bf6a046f:0xebfbb1ac4a04c344";
const hotpotTitle = "伙鍋桑 個人鍋物 林口店";
const hotpotPath = "https://www.google.com/maps/place/" + encodeURIComponent(hotpotTitle) + "/data=";
const hotpotOverviewUrl = hotpotPath + "!3m1!5s0x3442a6dc4493aa6d:0xd5601c719f065391!4m16!1m9!3m8!1s0x3442a6d9076ea2e7:0xe3e9c03d5b3f1258!2z5Y-w54Gj6aaZ6L6j5aSq5YKF!8m2!3d25.0746224!4d121.3696704!9m1!1b1!16s%2Fg%2F11c0vqc8y1!3m5!1s0x3442a716bf6a046f:0xebfbb1ac4a04c344!8m2!3d25.0781085!4d121.373171!16s%2Fg%2F11lymv8q6n";
const hotpotReviewsUrl = hotpotPath + "!3m1!5s0x3442a6dc4493aa6d:0xd5601c719f065391!4m18!1m9!3m8!1s0x3442a6d9076ea2e7:0xe3e9c03d5b3f1258!2z5Y-w54Gj6aaZ6L6j5aSq5YKF!8m2!3d25.0746224!4d121.3696704!9m1!1b1!16s%2Fg%2F11c0vqc8y1!3m7!1s0x3442a716bf6a046f:0xebfbb1ac4a04c344!8m2!3d25.0781085!4d121.373171!9m1!1b1!16s%2Fg%2F11lymv8q6n";

module.exports = {
  previousPlace, selectedPlace, placePath, observedDualPlaceUrl, dualPlaceUrl,
  hotpotPlace, hotpotTitle, hotpotOverviewUrl, hotpotReviewsUrl,
};
