// Date/time formatting, matching the widget's Qt formats.
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "h:mm A" -> 7:56 PM, "h A" -> 7 PM, "h:mma" -> 7:56pm
export function fmtTime(ms, f = "h:mm A") {
    const d = new Date(ms), h24 = d.getHours(), h = h24 % 12 || 12, m = String(d.getMinutes()).padStart(2, "0");
    const ap = h24 < 12 ? "AM" : "PM";
    return f === "h A" ? `${h} ${ap}` : f === "h:mma" ? `${h}:${m}${ap.toLowerCase()}` : `${h}:${m} ${ap}`;
}
export const fmtDay = ms => DAYS[new Date(ms).getDay()];                 // Mon
export const fmtDayLong = ms => DAYS_LONG[new Date(ms).getDay()];        // Monday
export const fmtMonthDay = ms => { const d = new Date(ms); return `${MONTHS[d.getMonth()]} ${d.getDate()}`; };  // Nov 9
export const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
