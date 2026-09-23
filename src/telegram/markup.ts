export type InlineButton={text:string;callback_data:string};
export type InlineKeyboard=InlineButton[][];
export type ReplyKeyboard={keyboard:string[][];resize_keyboard?:boolean;is_persistent?:boolean;one_time_keyboard?:boolean};

export const ik=(rows:InlineButton[][])=>({inline_keyboard:rows});
export const rk=(rows:string[][]):ReplyKeyboard=>({keyboard:rows,resize_keyboard:true,is_persistent:true});
