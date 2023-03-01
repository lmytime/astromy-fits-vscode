import * as vscode from 'vscode';
import { FitsEditorProvider } from './fitsPreviewer';

export function activate(context: vscode.ExtensionContext) {
	// Register our custom editor providers
	context.subscriptions.push(FitsEditorProvider.register(context));
}
