import React, {
  memo,
  forwardRef,
  useMemo,
  useState,
  useEffect,
  useImperativeHandle,
  useCallback
} from "react";
import {
  createEditor,
  Node,
  Transforms,
  NodeEntry,
  Range,
  Editor,
  Point
} from "slate";
import {
  Slate,
  Editable,
  withReact,
  ReactEditor,
  RenderLeafProps
} from "slate-react";
import { withHistory } from "slate-history";
import {
  Direction,
  KeyCodes,
  SelectionArea,
  castToString
} from "@rowsncolumns/grid";
import useShiftDown from "../hooks/useShiftDown";
import { useColorMode, useTheme, Box } from "@chakra-ui/core";
import {
  DARK_MODE_COLOR,
  FORMULA_FONT,
  FORMULA_FONT_SIZE,
  isAFormula
} from "../constants";
import {
  normalizeTokens,
  tokenVocabulary,
  getSelectionColorAtIndex
} from "./../formulas/helpers";
import { Token } from "fast-formula-parser/grammar/lexing";
import { current } from "immer";
import { css } from "@emotion/core";
import { FormulaChangeProps } from "../Grid/Grid";
import {
  getCurrentCursorOffset,
  functionSuggestion,
  getCurrentToken,
  showCellSuggestions,
  isCurrentPositionACell,
  cleanFunctionToken
} from "./helpers";

export interface EditableProps {
  value?: React.ReactText;
  onChange: (value: string) => void;
  onSubmit: (value: string, direction?: Direction) => void;
  onCancel: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  fontFamily: string;
  fontSize: number;
  scale: number;
  color: string;
  wrapping: any;
  horizontalAlign: any;
  underline?: boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  options?: string[];
  isFormulaMode?: boolean;
  autoFocus?: boolean;
  supportedFormulas?: string[];
  onFormulaChange?: (props: FormulaChangeProps) => void;
}

export type RefAttribute = {
  ref?: React.Ref<EditableRef | null>;
};

export type EditableRef = {
  focus: () => void;
  updateSelection?: (sel: SelectionArea) => void;
};

/**
 * Slate leaf renderer
 * @param param0
 */
const Leaf = ({ attributes, children, leaf }: RenderLeafProps) => {
  return (
    <span
      {...attributes}
      className={leaf.cursor ? "insert-range-indicator" : void 0}
      style={{
        color: leaf.color as string
      }}
    >
      {children}
    </span>
  );
};

const TextEditor: React.FC<EditableProps & RefAttribute> = memo(
  forwardRef((props, forwardedRef) => {
    const {
      value: initialValue,
      onChange,
      onSubmit,
      onCancel,
      fontFamily,
      fontSize,
      scale,
      color,
      wrapping,
      horizontalAlign,
      underline,
      onKeyDown,
      options,
      isFormulaMode,
      autoFocus,
      supportedFormulas = [],
      onFormulaChange,
      ...rest
    } = props;
    const [suggestionToken, setSuggestionToken] = useState<Token>();
    const [cursorToken, setCursorSuggestionToken] = useState<
      Point | undefined
    >();
    const [target, setTarget] = useState<Range | undefined>();
    const serialize = useCallback(
      (value?: React.ReactText): Node[] => {
        return (castToString(value) ?? "").split("\n").map((line: string) => {
          const children = [{ text: line }];
          return {
            children
          };
        });
      },
      [isFormulaMode]
    );
    const deserialize = useCallback((value: Node[]) => {
      return value
        .map(element => {
          // @ts-ignore
          return element.children.map(leaf => leaf.text).join("");
        })
        .join("\n");
    }, []);

    /**
     * Expose ref methods
     */
    useImperativeHandle(
      forwardedRef,
      () => {
        return {
          focus: () => {
            ReactEditor.focus(editor);
          },
          updateSelection: (sel: SelectionArea | undefined) => {
            // console.log("called", suggestionToken);
          }
        };
      },
      []
    );
    const [value, setValue] = useState<Node[]>(() => serialize(initialValue));
    const editor = useMemo(() => withHistory(withReact(createEditor())), []);
    const moveToEnd = useCallback(() => {
      ReactEditor.focus(editor);
      document.execCommand("selectAll", false, undefined);
      // collapse selection to the end
      document.getSelection()?.collapseToEnd();
    }, []);
    useEffect(() => {
      if (autoFocus) {
        requestAnimationFrame(moveToEnd);
      }
    }, []);

    const {
      highlightedIndex,
      onKeyDown: onShiftDownKeyDown,
      setInputValue,
      menuRef,
      selectedItem,
      items,
      closeMenu,
      onMouseMove,
      onMouseDown,
      onClick,
      isOpen,
      openMenu
    } = useShiftDown({
      showAllIfEmpty: !isFormulaMode,
      defaultHighlightedIndex: isFormulaMode ? 0 : null,
      initialInputValue: isFormulaMode ? "" : initialValue,
      initialIsOpen: isFormulaMode ? false : (options?.length ?? 0) > 0,
      initialSelectedItem: initialValue,
      options: isFormulaMode ? supportedFormulas : options,
      onChange: item => {
        if (isFormulaMode && item !== void 0) {
          const text = suggestionToken?.image;
          const start = getCurrentCursorOffset(editor);
          if (!start) {
            return;
          }
          const startToken = {
            ...start,
            offset: suggestionToken?.startOffset ?? 0
          };
          if (start) {
            Transforms.delete(editor, {
              at: startToken,
              distance: text?.length
            });

            Transforms.insertNodes(editor, [{ text: `${item as string}(` }]);
          }
          return;
        }
        onSubmit?.(item as string);
      }
    });

    useEffect(() => {
      items.length > 0 ? openMenu() : closeMenu();
    }, [items]);

    /**
     * Slate decorator
     */
    const decorate = useCallback(
      (entry: NodeEntry<Node>) => {
        if (!isFormulaMode) {
          return [];
        }

        const ranges: any = [];
        const [node, path] = entry;
        const { text } = node;
        let offset = 0;
        if (isFormulaMode) {
          const tokens = normalizeTokens(text as string);
          if (cursorToken && tokens.length && cursorToken.path[0] === path[0]) {
            ranges.push({
              anchor: { path, offset: cursorToken.offset },
              focus: { path, offset: cursorToken.offset },
              cursor: true
            });
          }
          let prevToken: Token;
          tokens.forEach(token => {
            let add = token.startOffset - (prevToken?.endColumn ?? 0);
            ranges.push({
              anchor: { path, offset: offset + token.image.length + add },
              focus: { path, offset },
              selection: !!token.sel,
              color:
                token?.index !== void 0
                  ? getSelectionColorAtIndex(token.index)
                  : token.tokenType.name === "String"
                  ? "green"
                  : token.tokenType.name === "Number"
                  ? "#15c"
                  : void 0
            });

            prevToken = token;

            offset = offset + token.image.length + add;
          });
        }

        return ranges;
      },
      [isFormulaMode, cursorToken]
    );

    useEffect(() => {
      const normalizedValue = deserialize(value);
      if (!isFormulaMode) {
        setInputValue(normalizedValue);
      }
      onChange?.(normalizedValue);
    }, [value]);

    useEffect(() => {
      /* Update editor text if initialValue changes, when user enters text in formula bar */
      if (deserialize(value) !== initialValue) {
        setValue(serialize(initialValue));
      }
    }, [initialValue]);

    const theme = useTheme();
    const { colorMode } = useColorMode();
    const isLight = colorMode === "light";
    const borderColor = isLight
      ? theme.colors.gray[300]
      : theme.colors.gray[600];
    const inputColor = isLight ? DARK_MODE_COLOR : theme.colors.white;
    const dropdownBgColor = isLight
      ? theme.colors.white
      : theme.colors.gray[700];

    return (
      <>
        <div
          style={{
            fontFamily: isFormulaMode ? FORMULA_FONT : fontFamily,
            fontSize: (isFormulaMode ? FORMULA_FONT_SIZE : fontSize) * scale,
            width: "100%",
            height: "100%",
            padding: "0 1px",
            margin: 0,
            boxSizing: "border-box",
            borderWidth: 0,
            outline: "none",
            resize: "none",
            overflow: "hidden",
            verticalAlign: "top",
            background: "transparent",
            color: color,
            whiteSpace: "pre-wrap",
            textAlign: isFormulaMode ? "left" : horizontalAlign,
            lineHeight: "normal",
            textDecoration: underline ? "underline" : "none",
            cursor: "text",
            flex: 1
          }}
        >
          <Slate
            editor={editor}
            value={value}
            onChange={value => {
              setValue(value);
              const isFormula = isAFormula(deserialize(value));
              if (isFormula) {
                const start = getCurrentCursorOffset(editor);
                if (!start) {
                  return;
                }
                const from = Editor.before(editor, start, { unit: "line" });
                const end =
                  Editor.after(editor, start, { unit: "line" }) || start;
                if (!from) {
                  return;
                }
                const range = Editor.range(editor, from, end);
                const line = Editor.string(editor, range);
                const tokens = normalizeTokens(line);
                const fnToken = functionSuggestion(tokens, editor);
                const curToken = getCurrentToken(tokens, editor);
                const showFnSuggestions = !!fnToken;
                const showCellSuggestion = showCellSuggestions(editor, tokens);
                const isCell = isCurrentPositionACell(editor, tokens);
                const isNewCell = !isCurrentPositionACell(editor, tokens);
                const cellTokenIndex = showCellSuggestion
                  ? curToken
                    ? isNewCell
                      ? curToken?.endColumn
                      : curToken?.startOffset
                    : getCurrentCursorOffset(editor)?.offset
                  : null;
                if (showFnSuggestions) {
                  setSuggestionToken(fnToken);
                  setInputValue(cleanFunctionToken(fnToken?.image ?? ""));
                } else {
                  setSuggestionToken(void 0);
                  setInputValue("");
                }

                onFormulaChange?.({
                  showCellSuggestion,
                  newSelectionMode: showCellSuggestion ? "append" : "modify"
                });

                setCursorSuggestionToken(
                  showCellSuggestion ? getCurrentCursorOffset(editor) : void 0
                );
              }
            }}
          >
            <Editable
              decorate={decorate}
              renderLeaf={props => <Leaf {...props} />}
              onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
                const isShiftKey = e.nativeEvent.shiftKey;
                const isMetaKey =
                  e.nativeEvent.metaKey || e.nativeEvent.ctrlKey;
                const isFromSelection =
                  highlightedIndex !== null && items.length > 0;
                const text = isFromSelection
                  ? (items[highlightedIndex as number] as string)
                  : deserialize(value);

                // Enter key
                if (e.which === KeyCodes.Enter) {
                  if (isFormulaMode && isFromSelection) {
                    setInputValue("");
                    e.preventDefault();
                  } else {
                    /* Add a new line when Cmd/Ctrl key is pressed */
                    if (isMetaKey) {
                      editor.insertBreak();
                      return;
                    }
                    onSubmit?.(
                      text,
                      isShiftKey ? Direction.Up : Direction.Down
                    );

                    e.preventDefault();

                    return;
                  }
                }

                if (e.which === KeyCodes.Escape) {
                  onCancel && onCancel(e);
                }

                if (e.which === KeyCodes.Tab) {
                  /* Trap focus inside the grid */
                  e.preventDefault();
                  onSubmit &&
                    onSubmit(
                      text,
                      isShiftKey ? Direction.Left : Direction.Right
                    );
                }
                /* Global handler */
                onKeyDown?.(e);

                /* Pass callback to shiftdown hook */
                onShiftDownKeyDown(e);
              }}
            />
          </Slate>
        </div>
        {isOpen ? (
          <Box
            ref={menuRef}
            width="auto"
            left="-2px"
            shadow="md"
            background={dropdownBgColor}
            pb={1}
            pt={1}
            position="absolute"
            top="100%"
            mt="2px"
            borderColor={borderColor}
            borderStyle="solid"
            borderWidth={1}
            minWidth="calc(100% + 4px)"
            maxHeight={400}
            overflow="auto"
          >
            {(items as string[]).map((item, index: number) => {
              return (
                <Box
                  padding={1}
                  pl={1}
                  pr={1}
                  whiteSpace="nowrap"
                  color={inputColor}
                  cursor="pointer"
                  fontFamily={isFormulaMode ? FORMULA_FONT : fontFamily}
                  fontSize={`${(isFormulaMode ? FORMULA_FONT_SIZE : fontSize) *
                    scale}px`}
                  onMouseMove={() => onMouseMove?.(index)}
                  onMouseDown={onMouseDown}
                  onClick={() => onClick?.(item)}
                  key={item}
                  style={{
                    fontWeight: selectedItem === item ? "bold" : "normal",
                    backgroundColor:
                      highlightedIndex === index
                        ? isLight
                          ? theme.colors.gray[100]
                          : "rgba(255,255,255,0.06)"
                        : dropdownBgColor
                  }}
                >
                  {item}
                </Box>
              );
            })}
          </Box>
        ) : null}
      </>
    );
  })
);

export default TextEditor;